require "time"

class Sync
  def initialize(state:, teams_config:, github_client:, config:, now: Time.now)
    @state = state
    @teams_config = teams_config
    @client = github_client
    @config = config
    @now = now.utc
  end

  def call
    reconcile_teams
    membership = fetch_team_members
    reconcile_users(membership)
    fetch_pull_requests
    @state.synced_at = @now
    @state.backfill_anchor ||= @config.backfill_anchor(now: @now)
    @state
  end

  private

  def reconcile_teams
    @state.teams.replace(
      @teams_config.entries.map { |e| { "org" => e.org, "slug" => e.slug } }
    )
  end

  def fetch_team_members
    membership = {} # github_id => { login:, avatar_url:, team_keys: [] }
    @teams_config.entries.each do |entry|
      team_key = "#{entry.org}/#{entry.slug}"
      @client.team_members(entry.org, entry.slug).each do |m|
        bucket = membership[m[:github_id]] ||= {
          login: m[:login], avatar_url: m[:avatar_url], team_keys: []
        }
        bucket[:team_keys] << team_key unless bucket[:team_keys].include?(team_key)
      end
    end
    membership
  end

  def reconcile_users(membership)
    by_id = @state.users.to_h { |u| [ u["github_id"], u ] }

    membership.each do |gh_id, attrs|
      user = by_id[gh_id] || begin
        fresh = { "github_id" => gh_id }
        @state.users << fresh
        fresh
      end
      user["login"] = attrs[:login]
      user["avatar_url"] = attrs[:avatar_url]
      user["team_keys"] = attrs[:team_keys].sort
      user["active"] = true
    end

    @state.users.each do |user|
      next if membership.key?(user["github_id"])
      user["active"] = false
      user["team_keys"] = []
    end
  end

  def fetch_pull_requests
    @state.users.each do |user|
      next unless user["active"]
      from = fetch_window_start(user)
      prs = @client.merged_prs(user["login"], from: from, to: @now)
      merge_prs(user["login"], prs)
    end
  end

  def fetch_window_start(user)
    latest = latest_recorded_merged_at(user["login"])
    return latest - 86_400 if latest # one-day overlap to absorb mid-window merges

    anchor = @state.backfill_anchor || @config.backfill_anchor(now: @now)
    Time.utc(anchor.year, anchor.month, anchor.day)
  end

  def latest_recorded_merged_at(login)
    timestamps = @state.pull_requests
      .select { |p| p["author_login"] == login }
      .map { |p| Time.iso8601(p["merged_at"]) }
    timestamps.max
  end

  def merge_prs(login, prs)
    seen = @state.pull_requests.to_h { |p| [ p["github_id"], true ] }
    prs.each do |pr|
      next if seen[pr[:github_id]]
      @state.pull_requests << {
        "github_id" => pr[:github_id],
        "author_login" => login,
        "merged_at" => pr[:merged_at].utc.iso8601,
        "html_url" => pr[:html_url],
        "repo_full_name" => pr[:repo_full_name]
      }
      seen[pr[:github_id]] = true
    end
  end
end

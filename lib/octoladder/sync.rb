require "set"
require "time"
require "active_support/core_ext/integer/time"

class Sync
  OVERLAP = 1.day

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
    membership = {}
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
      user = by_id[gh_id]
      unless user
        user = { "github_id" => gh_id }
        @state.users << user
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
    latest_by_login = index_latest_merged_at
    seen_ids = @state.pull_requests.map { |p| p["github_id"] }.to_set

    @state.users.each do |user|
      next unless user["active"]
      from = fetch_window_start(latest_by_login[user["login"]])
      prs = @client.merged_prs(user["login"], from: from, to: @now)
      prs.each do |pr|
        next if seen_ids.include?(pr[:github_id])
        @state.pull_requests << {
          "github_id" => pr[:github_id],
          "author_login" => user["login"],
          "merged_at" => pr[:merged_at].utc.iso8601,
          "html_url" => pr[:html_url],
          "repo_full_name" => pr[:repo_full_name]
        }
        seen_ids << pr[:github_id]
      end
    end
  end

  def index_latest_merged_at
    @state.pull_requests.each_with_object({}) do |pr, index|
      t = Time.iso8601(pr["merged_at"])
      login = pr["author_login"]
      index[login] = t if index[login].nil? || index[login] < t
    end
  end

  def fetch_window_start(latest)
    return latest - OVERLAP if latest

    anchor = @state.backfill_anchor || @config.backfill_anchor(now: @now)
    Time.utc(anchor.year, anchor.month, anchor.day)
  end
end

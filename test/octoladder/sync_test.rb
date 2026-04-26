require "test_helper"
require "octoladder/sync"
require "octoladder/state"
require "octoladder/teams_config"
require "octoladder/github_client"
require "octoladder/config"

class SyncTest < ActiveSupport::TestCase
  def setup
    @config = OctoladderConfig.new("time_zone" => "Asia/Tokyo")
    @teams_config = TeamsConfig.new([
      { "org" => "acme",   "team_slug" => "platform" },
      { "org" => "acme",   "team_slug" => "infra" }
    ])
    @client = GithubClient.new(token: "test-token")
    @now = Time.utc(2026, 4, 27, 17, 0, 0)
  end

  def stub_team_members(org, slug, members)
    stub_request(:get, "https://api.github.com/orgs/#{org}/teams/#{slug}/members?per_page=100")
      .to_return(
        status: 200,
        headers: { "Content-Type" => "application/json" },
        body: members.to_json
      )
  end

  def stub_search(login, items: [], total_count: nil)
    total_count ||= items.size
    stub_request(:get, %r{api\.github\.com/search/issues})
      .with(query: hash_including("q" => /author:#{login}/))
      .to_return(
        status: 200,
        headers: { "Content-Type" => "application/json" },
        body: { total_count: total_count, items: items }.to_json
      )
  end

  def pr_item(id, repo:, merged_at:)
    {
      id: id,
      html_url: "https://github.com/#{repo}/pull/#{id}",
      repository_url: "https://api.github.com/repos/#{repo}",
      pull_request: { merged_at: merged_at }
    }
  end

  def run_sync(state)
    Sync.new(
      state: state,
      teams_config: @teams_config,
      github_client: @client,
      config: @config,
      now: @now
    ).call
  end

  # ---- empty state backfill ----

  test "empty state backfill adds users and PRs from the anchor" do
    stub_team_members("acme", "platform", [
      { id: 1, login: "alice", avatar_url: "https://example.com/a.png" }
    ])
    stub_team_members("acme", "infra", [])

    expected_from = "2025-01-01T00:00:00Z"
    expected_to = "2026-04-27T16:59:59Z"
    expected_q = "is:pr is:merged is:public author:alice merged:#{expected_from}..#{expected_to}"
    stub_request(:get, "https://api.github.com/search/issues")
      .with(query: hash_including("q" => expected_q))
      .to_return(
        status: 200,
        headers: { "Content-Type" => "application/json" },
        body: { total_count: 1, items: [
          pr_item(100, repo: "acme/widget", merged_at: "2026-04-20T09:00:00Z")
        ] }.to_json
      )

    state = State.new
    run_sync(state)

    assert_equal 1, state.users.size
    assert_equal "alice", state.users.first["login"]
    assert_equal true, state.users.first["active"]
    assert_equal [ "acme/platform" ], state.users.first["team_keys"]

    assert_equal 1, state.pull_requests.size
    pr = state.pull_requests.first
    assert_equal 100, pr["github_id"]
    assert_equal "alice", pr["author_login"]
    assert_equal "2026-04-20T09:00:00Z", pr["merged_at"]
    assert_equal "acme/widget", pr["repo_full_name"]

    assert_equal @now, state.synced_at
    assert_equal Date.new(2025, 1, 1), state.backfill_anchor
  end

  # ---- incremental fetch ----

  test "incremental fetch starts one day before the latest recorded PR" do
    stub_team_members("acme", "platform", [
      { id: 1, login: "alice", avatar_url: "https://example.com/a.png" }
    ])
    stub_team_members("acme", "infra", [])

    expected_from = "2026-04-19T09:00:00Z"
    expected_to = "2026-04-27T16:59:59Z"
    stub_request(:get, "https://api.github.com/search/issues")
      .with(query: hash_including("q" => "is:pr is:merged is:public author:alice merged:#{expected_from}..#{expected_to}"))
      .to_return(
        status: 200,
        headers: { "Content-Type" => "application/json" },
        body: { total_count: 0, items: [] }.to_json
      )

    state = State.new(
      synced_at: Time.utc(2026, 4, 20),
      backfill_anchor: Date.new(2025, 1, 1),
      users: [ {
        "github_id" => 1, "login" => "alice", "avatar_url" => "x",
        "team_keys" => [ "acme/platform" ], "active" => true
      } ],
      pull_requests: [ {
        "github_id" => 100, "author_login" => "alice",
        "merged_at" => "2026-04-20T09:00:00Z",
        "html_url" => "x", "repo_full_name" => "acme/widget"
      } ]
    )
    run_sync(state)

    assert_requested :get, %r{api\.github\.com/search/issues},
      query: hash_including("q" => /merged:#{expected_from}/)
  end

  # ---- user join ----

  test "newly added team member is recorded as active" do
    stub_team_members("acme", "platform", [
      { id: 1, login: "alice", avatar_url: "x" },
      { id: 2, login: "bob", avatar_url: "y" }
    ])
    stub_team_members("acme", "infra", [])
    stub_search("alice")
    stub_search("bob")

    state = State.new(
      synced_at: Time.utc(2026, 4, 20),
      backfill_anchor: Date.new(2025, 1, 1),
      users: [ {
        "github_id" => 1, "login" => "alice", "avatar_url" => "x",
        "team_keys" => [ "acme/platform" ], "active" => true
      } ]
    )
    run_sync(state)

    bob = state.users.find { |u| u["login"] == "bob" }
    refute_nil bob
    assert_equal true, bob["active"]
    assert_equal [ "acme/platform" ], bob["team_keys"]
  end

  # ---- user leave ----

  test "user who left every tracked team is deactivated, PRs preserved" do
    stub_team_members("acme", "platform", []) # alice gone
    stub_team_members("acme", "infra", [])

    state = State.new(
      synced_at: Time.utc(2026, 4, 20),
      backfill_anchor: Date.new(2025, 1, 1),
      users: [ {
        "github_id" => 1, "login" => "alice", "avatar_url" => "x",
        "team_keys" => [ "acme/platform" ], "active" => true
      } ],
      pull_requests: [ {
        "github_id" => 100, "author_login" => "alice",
        "merged_at" => "2026-04-20T09:00:00Z",
        "html_url" => "x", "repo_full_name" => "acme/widget"
      } ]
    )
    run_sync(state)

    alice = state.users.find { |u| u["login"] == "alice" }
    assert_equal false, alice["active"]
    assert_empty alice["team_keys"]
    assert_equal 1, state.pull_requests.size # unchanged
    assert_not_requested :get, %r{api\.github\.com/search/issues}
  end

  # ---- team removal ----

  test "removing a team from config stops fetching for users only in that team" do
    teams_config = TeamsConfig.new([ { "org" => "acme", "team_slug" => "platform" } ]) # infra removed
    stub_team_members("acme", "platform", [])

    state = State.new(
      synced_at: Time.utc(2026, 4, 20),
      backfill_anchor: Date.new(2025, 1, 1),
      users: [ {
        "github_id" => 1, "login" => "alice", "avatar_url" => "x",
        "team_keys" => [ "acme/infra" ], "active" => true
      } ],
      pull_requests: []
    )

    Sync.new(
      state: state, teams_config: teams_config,
      github_client: @client, config: @config, now: @now
    ).call

    assert_equal false, state.users.first["active"]
    assert_not_requested :get, %r{api\.github\.com/search/issues}
    assert_equal [ { "org" => "acme", "slug" => "platform" } ], state.teams
  end

  # ---- multi-team membership ----

  test "user belonging to multiple tracked teams gets sorted team_keys" do
    stub_team_members("acme", "platform", [
      { id: 1, login: "alice", avatar_url: "x" }
    ])
    stub_team_members("acme", "infra", [
      { id: 1, login: "alice", avatar_url: "x" }
    ])
    stub_search("alice")

    state = State.new
    run_sync(state)

    assert_equal [ "acme/infra", "acme/platform" ], state.users.first["team_keys"]
  end

  # ---- PR dedup ----

  test "PRs returned again on subsequent sync are deduped by github_id" do
    stub_team_members("acme", "platform", [
      { id: 1, login: "alice", avatar_url: "x" }
    ])
    stub_team_members("acme", "infra", [])

    stub_request(:get, %r{api\.github\.com/search/issues})
      .to_return(
        status: 200,
        headers: { "Content-Type" => "application/json" },
        body: { total_count: 1, items: [
          pr_item(100, repo: "acme/widget", merged_at: "2026-04-20T09:00:00Z")
        ] }.to_json
      )

    state = State.new(
      synced_at: Time.utc(2026, 4, 20),
      backfill_anchor: Date.new(2025, 1, 1),
      users: [ {
        "github_id" => 1, "login" => "alice", "avatar_url" => "x",
        "team_keys" => [ "acme/platform" ], "active" => true
      } ],
      pull_requests: [ {
        "github_id" => 100, "author_login" => "alice",
        "merged_at" => "2026-04-20T09:00:00Z",
        "html_url" => "x", "repo_full_name" => "acme/widget"
      } ]
    )
    run_sync(state)

    assert_equal 1, state.pull_requests.size
  end
end

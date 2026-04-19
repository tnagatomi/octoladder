require "test_helper"

class GithubClientTest < ActiveSupport::TestCase
  setup do
    @client = GithubClient.new(token: "test-token")
  end

  def with_env(vars)
    originals = vars.to_h { |k, _| [ k, ENV[k] ] }
    vars.each { |k, v| v.nil? ? ENV.delete(k) : ENV[k] = v }
    yield
  ensure
    originals.each { |k, v| v.nil? ? ENV.delete(k) : ENV[k] = v }
  end

  # ---- from_env ----

  test "from_env builds a client when GITHUB_TOKEN is set" do
    with_env("GITHUB_TOKEN" => "abc") do
      assert_instance_of GithubClient, GithubClient.from_env
    end
  end

  test "from_env raises when GITHUB_TOKEN is missing" do
    with_env("GITHUB_TOKEN" => nil) do
      assert_raises(GithubClient::MissingToken) { GithubClient.from_env }
    end
  end

  test "from_env raises when GITHUB_TOKEN is blank" do
    with_env("GITHUB_TOKEN" => "  ") do
      assert_raises(GithubClient::MissingToken) { GithubClient.from_env }
    end
  end

  # ---- team_members ----

  test "team_members returns normalized hashes" do
    stub_request(:get, "https://api.github.com/orgs/acme/teams/platform/members?per_page=100")
      .to_return(
        status: 200,
        headers: { "Content-Type" => "application/json" },
        body: [
          { id: 42,  login: "octocat", avatar_url: "https://example.com/a.png" },
          { id: 101, login: "hubot",   avatar_url: "https://example.com/h.png" }
        ].to_json
      )

    members = @client.team_members("acme", "platform")
    assert_equal [
      { github_id: 42,  login: "octocat", avatar_url: "https://example.com/a.png" },
      { github_id: 101, login: "hubot",   avatar_url: "https://example.com/h.png" }
    ], members
  end

  test "team_members follows pagination via Link header" do
    stub_request(:get, "https://api.github.com/orgs/acme/teams/platform/members?per_page=100")
      .to_return(
        status: 200,
        headers: {
          "Content-Type" => "application/json",
          "Link" => '<https://api.github.com/orgs/acme/teams/platform/members?page=2&per_page=100>; rel="next"'
        },
        body: [ { id: 1, login: "a", avatar_url: "x" } ].to_json
      )
    stub_request(:get, "https://api.github.com/orgs/acme/teams/platform/members?page=2&per_page=100")
      .to_return(
        status: 200,
        headers: { "Content-Type" => "application/json" },
        body: [ { id: 2, login: "b", avatar_url: "y" } ].to_json
      )

    members = @client.team_members("acme", "platform")
    assert_equal [ "a", "b" ], members.map { |m| m[:login] }
  end

  test "team_members raises Octokit::Unauthorized on 401" do
    stub_request(:get, %r{api\.github\.com/orgs/.*})
      .to_return(status: 401, body: "{}", headers: { "Content-Type" => "application/json" })
    assert_raises(Octokit::Unauthorized) { @client.team_members("acme", "platform") }
  end

  test "team_members raises Octokit::NotFound on 404" do
    stub_request(:get, %r{api\.github\.com/orgs/.*})
      .to_return(status: 404, body: "{}", headers: { "Content-Type" => "application/json" })
    assert_raises(Octokit::NotFound) { @client.team_members("acme", "missing") }
  end

  # ---- merged_prs ----

  test "merged_prs builds a half-open search range and normalizes results" do
    from = Time.utc(2026, 4, 6)
    to   = Time.utc(2026, 4, 13)
    expected_q = "is:pr is:merged is:public author:octocat merged:2026-04-06T00:00:00Z..2026-04-12T23:59:59Z"

    stub_request(:get, "https://api.github.com/search/issues")
      .with(query: hash_including("q" => expected_q))
      .to_return(
        status: 200,
        headers: { "Content-Type" => "application/json" },
        body: {
          total_count: 1,
          items: [
            {
              id: 999,
              html_url: "https://github.com/acme/widget/pull/12",
              repository_url: "https://api.github.com/repos/acme/widget",
              pull_request: { merged_at: "2026-04-07T10:15:30Z" }
            }
          ]
        }.to_json
      )

    prs = @client.merged_prs("octocat", from: from, to: to)
    assert_equal 1, prs.size
    assert_equal 999,                                       prs.first[:github_id]
    assert_equal "https://github.com/acme/widget/pull/12",  prs.first[:html_url]
    assert_equal "acme/widget",                             prs.first[:repo_full_name]
    assert_equal Time.utc(2026, 4, 7, 10, 15, 30),          prs.first[:merged_at]
  end

  test "merged_prs returns an empty list when search has no hits" do
    stub_request(:get, %r{api\.github\.com/search/issues})
      .to_return(
        status: 200,
        headers: { "Content-Type" => "application/json" },
        body: { total_count: 0, items: [] }.to_json
      )

    prs = @client.merged_prs("octocat", from: Time.utc(2026, 1, 1), to: Time.utc(2026, 2, 1))
    assert_equal [], prs
  end

  test "merged_prs converts naive local times to UTC in the search range" do
    from = Time.zone.local(2026, 4, 6)
    to   = Time.zone.local(2026, 4, 13)
    expected_q = "is:pr is:merged is:public author:octocat merged:2026-04-05T15:00:00Z..2026-04-12T14:59:59Z"

    stub_request(:get, "https://api.github.com/search/issues")
      .with(query: hash_including("q" => expected_q))
      .to_return(
        status: 200,
        headers: { "Content-Type" => "application/json" },
        body: { total_count: 0, items: [] }.to_json
      )

    @client.merged_prs("octocat", from: from, to: to)
    assert_requested :get, "https://api.github.com/search/issues",
      query: hash_including("q" => expected_q)
  end

  test "merged_prs authenticates with the supplied token" do
    stub_request(:get, %r{api\.github\.com/search/issues})
      .with(headers: { "Authorization" => "token test-token" })
      .to_return(
        status: 200,
        headers: { "Content-Type" => "application/json" },
        body: { total_count: 0, items: [] }.to_json
      )

    @client.merged_prs("octocat", from: Time.utc(2026, 1, 1), to: Time.utc(2026, 2, 1))
    assert_requested :get, %r{api\.github\.com/search/issues},
      headers: { "Authorization" => "token test-token" }
  end
end

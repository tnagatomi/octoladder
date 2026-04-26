require "test_helper"
require "tmpdir"
require "octoladder/site"
require "octoladder/state"

class SiteTest < ActiveSupport::TestCase
  def setup
    @now = Time.zone.local(2026, 4, 27, 12, 0, 0)
  end

  def state_with(prs: [], users: [], anchor: Date.new(2026, 4, 1))
    State.new(
      synced_at: @now,
      backfill_anchor: anchor,
      users: users,
      pull_requests: prs
    )
  end

  def alice_user(active: true)
    {
      "github_id" => 1, "login" => "alice", "avatar_url" => "https://example.com/a.png",
      "team_keys" => [ "acme/platform" ], "active" => active
    }
  end

  def pr(id, author:, merged_at:)
    {
      "github_id" => id, "author_login" => author,
      "merged_at" => merged_at,
      "html_url" => "https://github.com/acme/widget/pull/#{id}",
      "repo_full_name" => "acme/widget"
    }
  end

  test "enumerate_periods returns no periods when state has no anchor" do
    site = Site.new(state: State.new, output_dir: "/tmp/x", now: @now)
    assert_empty site.enumerate_periods(:weekly)
  end

  test "enumerate_periods covers anchor through latest closed for weekly" do
    state = state_with(anchor: Date.new(2026, 4, 1))
    site = Site.new(state: state, output_dir: "/tmp/x", now: @now)
    weeks = site.enumerate_periods(:weekly)
    # 2026-04-01 is in the week of Mon 2026-03-30. Latest closed (now is Mon
    # 2026-04-27) is the week of Mon 2026-04-20. So weeks: 03-30, 04-06,
    # 04-13, 04-20 = 4 entries.
    assert_equal 4, weeks.size
    assert_equal Time.zone.local(2026, 3, 30), weeks.first.starts_at
    assert_equal Time.zone.local(2026, 4, 20), weeks.last.starts_at
  end

  test "enumerate_periods covers monthly periods" do
    state = state_with(anchor: Date.new(2025, 11, 15))
    site = Site.new(state: state, output_dir: "/tmp/x", now: @now)
    months = site.enumerate_periods(:monthly)
    # 2025-11 (containing anchor) through 2026-03 (latest closed before
    # 2026-04-27) = 5 months
    assert_equal 5, months.size
    assert_equal Time.zone.local(2025, 11, 1), months.first.starts_at
    assert_equal Time.zone.local(2026, 3, 1), months.last.starts_at
  end

  test "enumerate_periods covers yearly periods" do
    state = state_with(anchor: Date.new(2025, 1, 1))
    site = Site.new(state: state, output_dir: "/tmp/x", now: @now)
    years = site.enumerate_periods(:yearly)
    assert_equal 1, years.size
    assert_equal Time.zone.local(2025, 1, 1), years.first.starts_at
  end

  test "call writes period files for every type at expected paths" do
    Dir.mktmpdir do |dir|
      state = state_with(
        anchor: Date.new(2025, 1, 1),
        users: [ alice_user ],
        prs: [ pr(100, author: "alice", merged_at: "2026-04-22T09:00:00Z") ]
      )
      Site.new(state: state, output_dir: dir, now: @now).call

      weekly_param = Period.latest_closed(:weekly, now: @now).to_param
      monthly_param = Period.latest_closed(:monthly, now: @now).to_param
      yearly_param = Period.latest_closed(:yearly, now: @now).to_param
      assert File.exist?(File.join(dir, "weekly", "#{weekly_param}.html"))
      assert File.exist?(File.join(dir, "monthly", "#{monthly_param}.html"))
      assert File.exist?(File.join(dir, "yearly", "#{yearly_param}.html"))
      assert File.exist?(File.join(dir, "index.html"))
    end
  end

  test "call writes a ranking with the contributor's login in the period file" do
    Dir.mktmpdir do |dir|
      state = state_with(
        users: [ alice_user ],
        prs: [
          pr(100, author: "alice", merged_at: "2026-04-22T09:00:00Z"),
          pr(101, author: "alice", merged_at: "2026-04-23T09:00:00Z")
        ]
      )
      Site.new(state: state, output_dir: dir, now: @now).call

      latest_weekly_param = Period.latest_closed(:weekly, now: @now).to_param
      html = File.read(File.join(dir, "weekly", "#{latest_weekly_param}.html"))
      assert_match(/alice/, html)
      assert_match(/<td class="count">2<\/td>/, html)
    end
  end

  test "call renders an empty period without crashing" do
    Dir.mktmpdir do |dir|
      state = state_with(prs: [], anchor: Date.new(2026, 4, 1))
      Site.new(state: state, output_dir: dir, now: @now).call

      latest_weekly_param = Period.latest_closed(:weekly, now: @now).to_param
      html = File.read(File.join(dir, "weekly", "#{latest_weekly_param}.html"))
      assert_match(/No merged PRs/, html)
    end
  end

  test "call writes index.html that redirects to the latest weekly period" do
    Dir.mktmpdir do |dir|
      state = state_with(prs: [], anchor: Date.new(2026, 4, 1))
      Site.new(state: state, output_dir: dir, now: @now).call

      latest_weekly_param = Period.latest_closed(:weekly, now: @now).to_param
      html = File.read(File.join(dir, "index.html"))
      assert_match(%r{<meta http-equiv="refresh" content="0; url=weekly/#{latest_weekly_param}\.html">}, html)
    end
  end

  test "call copies assets (CSS) into output_dir/assets" do
    Dir.mktmpdir do |dir|
      Site.new(state: state_with, output_dir: dir, now: @now).call
      assert File.exist?(File.join(dir, "assets", "style.css"))
    end
  end

  test "PRs from inactive users still appear in historical rankings" do
    Dir.mktmpdir do |dir|
      state = state_with(
        users: [ alice_user(active: false) ],
        prs: [ pr(100, author: "alice", merged_at: "2026-04-22T09:00:00Z") ]
      )
      Site.new(state: state, output_dir: dir, now: @now).call

      latest_weekly_param = Period.latest_closed(:weekly, now: @now).to_param
      html = File.read(File.join(dir, "weekly", "#{latest_weekly_param}.html"))
      assert_match(/alice/, html)
      assert_match(/inactive/, html)
    end
  end
end

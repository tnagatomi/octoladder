require "test_helper"
require "tempfile"
require "tmpdir"
require "octoladder/state"

class StateTest < ActiveSupport::TestCase
  test "load on a missing file returns an empty state" do
    state = State.load("/tmp/octoladder-no-such-file-#{Process.pid}.json")
    assert_nil state.synced_at
    assert_nil state.backfill_anchor
    assert_empty state.teams
    assert_empty state.users
    assert_empty state.pull_requests
  end

  test "save creates parent directories" do
    Dir.mktmpdir do |dir|
      path = File.join(dir, "nested", "subdir", "state.json")
      State.new.save(path)
      assert File.exist?(path)
    end
  end

  test "save then load round-trips synced_at and backfill_anchor" do
    Dir.mktmpdir do |dir|
      path = File.join(dir, "state.json")
      State.new(
        synced_at: Time.utc(2026, 4, 27, 17, 0, 0),
        backfill_anchor: Date.new(2025, 1, 1)
      ).save(path)

      loaded = State.load(path)
      assert_equal Time.utc(2026, 4, 27, 17, 0, 0), loaded.synced_at
      assert_equal Date.new(2025, 1, 1), loaded.backfill_anchor
    end
  end

  test "save sorts users by github_id" do
    state = State.new(users: [
      { "github_id" => 30, "login" => "c" },
      { "github_id" => 10, "login" => "a" },
      { "github_id" => 20, "login" => "b" }
    ])

    sorted = state.to_h["users"].map { |u| u["github_id"] }
    assert_equal [ 10, 20, 30 ], sorted
  end

  test "save sorts pull_requests by merged_at then github_id" do
    state = State.new(pull_requests: [
      { "github_id" => 2, "merged_at" => "2026-04-20T10:00:00Z" },
      { "github_id" => 1, "merged_at" => "2026-04-20T10:00:00Z" },
      { "github_id" => 3, "merged_at" => "2026-04-19T10:00:00Z" }
    ])

    keys = state.to_h["pull_requests"].map { |p| [ p["merged_at"], p["github_id"] ] }
    assert_equal [
      [ "2026-04-19T10:00:00Z", 3 ],
      [ "2026-04-20T10:00:00Z", 1 ],
      [ "2026-04-20T10:00:00Z", 2 ]
    ], keys
  end

  test "save sorts teams by org then slug" do
    state = State.new(teams: [
      { "org" => "rails", "slug" => "core" },
      { "org" => "rails", "slug" => "activerecord" },
      { "org" => "anthropic", "slug" => "core" }
    ])

    keys = state.to_h["teams"].map { |t| [ t["org"], t["slug"] ] }
    assert_equal [
      [ "anthropic", "core" ],
      [ "rails", "activerecord" ],
      [ "rails", "core" ]
    ], keys
  end

  test "saved JSON is human-readable and stable" do
    Dir.mktmpdir do |dir|
      path = File.join(dir, "state.json")
      state = State.new(
        synced_at: Time.utc(2026, 4, 27, 17, 0, 0),
        users: [ { "github_id" => 1, "login" => "dhh" } ]
      )
      state.save(path)
      first = File.read(path)
      state.save(path)
      second = File.read(path)
      assert_equal first, second
      assert_includes first, "\"schema_version\": 1"
      assert first.end_with?("\n"), "expected trailing newline"
    end
  end

  test "load rejects unknown schema versions" do
    Dir.mktmpdir do |dir|
      path = File.join(dir, "state.json")
      File.write(path, JSON.pretty_generate({ "schema_version" => 99 }))
      assert_raises(State::IncompatibleSchema) { State.load(path) }
    end
  end

  test "synced_at is normalized to UTC on save" do
    state = State.new(synced_at: Time.new(2026, 4, 27, 12, 0, 0, "+09:00"))
    assert_equal "2026-04-27T03:00:00Z", state.to_h["synced_at"]
  end
end

require "test_helper"
require "tempfile"
require "octoladder/config"

class OctoladderConfigTest < ActiveSupport::TestCase
  test "defaults when given an empty hash" do
    config = OctoladderConfig.new({})
    assert_equal "Asia/Tokyo", config.time_zone
  end

  test "honors explicit time_zone" do
    config = OctoladderConfig.new("time_zone" => "America/Los_Angeles")
    assert_equal "America/Los_Angeles", config.time_zone
  end

  test "rejects unknown time_zone" do
    assert_raises(OctoladderConfig::InvalidConfig) do
      OctoladderConfig.new("time_zone" => "Mars/Olympus")
    end
  end

  test "rejects non-mapping input" do
    assert_raises(OctoladderConfig::InvalidConfig) { OctoladderConfig.new([]) }
  end

  test "backfill_anchor is Jan 1 of the previous calendar year in TZ" do
    config = OctoladderConfig.new("time_zone" => "Asia/Tokyo")
    now = Time.utc(2026, 4, 27)
    assert_equal Date.new(2025, 1, 1), config.backfill_anchor(now: now)
  end

  test "backfill_anchor honors TZ when computing the previous year" do
    # 2026-01-01 00:30 UTC is still 2025-12-31 in Los Angeles, so the
    # "previous year" anchor is 2024-01-01, not 2025-01-01.
    config = OctoladderConfig.new("time_zone" => "America/Los_Angeles")
    now = Time.utc(2026, 1, 1, 0, 30)
    assert_equal Date.new(2024, 1, 1), config.backfill_anchor(now: now)
  end

  test "load returns defaults when the file does not exist" do
    config = OctoladderConfig.load("/tmp/octoladder-nonexistent-#{Process.pid}.yml")
    assert_equal "Asia/Tokyo", config.time_zone
  end

  test "load reads time_zone from disk" do
    Tempfile.create([ "octoladder", ".yml" ]) do |f|
      f.write("time_zone: Europe/Berlin\n")
      f.flush
      config = OctoladderConfig.load(f.path)
      assert_equal "Europe/Berlin", config.time_zone
    end
  end

  test "apply! sets Time.zone" do
    original = Time.zone
    OctoladderConfig.new("time_zone" => "America/Los_Angeles").apply!
    assert_equal "America/Los_Angeles", Time.zone.name
  ensure
    Time.zone = original
  end
end

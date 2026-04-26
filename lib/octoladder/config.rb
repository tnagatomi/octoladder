require "yaml"
require "date"
require "active_support/all"

class OctoladderConfig
  class InvalidConfig < ArgumentError; end

  DEFAULT_PATH = File.expand_path("../../config/octoladder.yml", __dir__)
  DEFAULT_TIME_ZONE = "Asia/Tokyo"

  def self.load(path = DEFAULT_PATH)
    raw = File.exist?(path) ? (YAML.safe_load_file(path) || {}) : {}
    new(raw)
  end

  attr_reader :time_zone

  def initialize(raw)
    raise InvalidConfig, "expected a mapping, got #{raw.class}" unless raw.is_a?(Hash)

    @time_zone = (raw["time_zone"] || DEFAULT_TIME_ZONE).to_s
    raise InvalidConfig, "unknown time_zone: #{@time_zone.inspect}" unless ActiveSupport::TimeZone[@time_zone]
  end

  # Earliest merged_at to ingest on first sync. Fixed at Jan 1 of the previous
  # calendar year in the configured TZ — wide enough that the most recent
  # closed weekly / monthly / yearly periods are all populated on day 1, and
  # narrow enough to avoid runaway rate-limited backfills.
  def backfill_anchor(now: Time.now)
    local = now.in_time_zone(time_zone)
    Date.new(local.year - 1, 1, 1)
  end

  def apply!
    Time.zone = time_zone
    self
  end
end

require "json"
require "date"
require "time"
require "fileutils"

class State
  SCHEMA_VERSION = 1

  class IncompatibleSchema < StandardError; end

  attr_accessor :synced_at, :backfill_anchor
  attr_reader :teams, :users, :pull_requests

  def self.load(path)
    return new unless File.exist?(path)

    raw = JSON.parse(File.read(path))
    version = raw["schema_version"]
    raise IncompatibleSchema, "schema_version=#{version.inspect} (expected #{SCHEMA_VERSION})" unless version == SCHEMA_VERSION

    new(
      synced_at: raw["synced_at"] ? Time.iso8601(raw["synced_at"]) : nil,
      backfill_anchor: raw["backfill_anchor"] ? Date.iso8601(raw["backfill_anchor"]) : nil,
      teams: raw["teams"] || [],
      users: raw["users"] || [],
      pull_requests: raw["pull_requests"] || []
    )
  end

  def initialize(synced_at: nil, backfill_anchor: nil, teams: [], users: [], pull_requests: [])
    @synced_at = synced_at
    @backfill_anchor = backfill_anchor
    @teams = teams
    @users = users
    @pull_requests = pull_requests
  end

  def save(path)
    FileUtils.mkdir_p(File.dirname(path))
    File.write(path, JSON.pretty_generate(to_h) + "\n")
  end

  def to_h
    {
      "schema_version" => SCHEMA_VERSION,
      "synced_at" => synced_at&.utc&.iso8601,
      "backfill_anchor" => backfill_anchor&.iso8601,
      "teams" => teams.sort_by { |t| [ t["org"], t["slug"] ] },
      "users" => users.sort_by { |u| u["github_id"] },
      "pull_requests" => pull_requests.sort_by { |p| [ p["merged_at"], p["github_id"] ] }
    }
  end
end

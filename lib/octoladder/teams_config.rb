require "yaml"

class TeamsConfig
  Entry = Data.define(:org, :slug)

  class InvalidConfig < ArgumentError; end

  DEFAULT_PATH = File.expand_path("../../config/teams.yml", __dir__)

  def self.load(path = DEFAULT_PATH)
    new(YAML.safe_load_file(path) || [])
  end

  attr_reader :entries

  def initialize(raw)
    @entries = parse(raw).freeze
  end

  private

  def parse(raw)
    raise InvalidConfig, "expected a list of teams, got #{raw.class}" unless raw.is_a?(Array)

    seen = {}
    raw.map.with_index do |row, i|
      raise InvalidConfig, "entry #{i}: expected a mapping" unless row.is_a?(Hash)

      entry = Entry.new(
        org:  require_string(row, "org", i),
        slug: require_string(row, "team_slug", i)
      )

      key = [ entry.org, entry.slug ]
      raise InvalidConfig, "duplicate entry: #{entry.org}/#{entry.slug}" if seen[key]
      seen[key] = true

      entry
    end
  end

  def require_string(row, key, index)
    value = row[key].to_s.strip
    raise InvalidConfig, "entry #{index}: missing #{key}" if value.empty?
    value
  end
end

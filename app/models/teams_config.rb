require "yaml"

# Loads config/teams.yml, the declarative source of truth for tracked teams.
#
# Expected shape:
#
#   - org: acme
#     team_slug: platform
#   - org: acme
#     team_slug: infra
class TeamsConfig
  include Enumerable

  Entry = Data.define(:org, :slug)

  class InvalidConfig < StandardError; end

  DEFAULT_PATH = Rails.root.join("config/teams.yml")

  class << self
    def load(path = DEFAULT_PATH)
      raw = YAML.safe_load_file(path) || []
      new(raw)
    end
  end

  attr_reader :entries

  def initialize(raw)
    @entries = parse(raw).freeze
  end

  def each(&block)
    entries.each(&block)
  end

  private

  def parse(raw)
    raise InvalidConfig, "expected a list of teams, got #{raw.class}" unless raw.is_a?(Array)

    seen = {}
    raw.each_with_index.map do |row, i|
      raise InvalidConfig, "entry #{i}: expected a mapping" unless row.is_a?(Hash)

      org  = row["org"].to_s.strip
      slug = row["team_slug"].to_s.strip
      raise InvalidConfig, "entry #{i}: missing org"       if org.empty?
      raise InvalidConfig, "entry #{i}: missing team_slug" if slug.empty?

      key = [ org, slug ]
      raise InvalidConfig, "duplicate entry: #{org}/#{slug}" if seen[key]
      seen[key] = true

      Entry.new(org: org, slug: slug)
    end
  end
end

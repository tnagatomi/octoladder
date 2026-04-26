require "test_helper"

class TeamsConfigTest < ActiveSupport::TestCase
  test "parses a list of org/team_slug entries" do
    config = TeamsConfig.new([
      { "org" => "acme", "team_slug" => "platform" },
      { "org" => "acme", "team_slug" => "infra" }
    ])
    assert_equal 2, config.entries.size
    assert_equal "acme",     config.entries.first.org
    assert_equal "platform", config.entries.first.slug
  end

  test "entries are frozen so callers cannot mutate them" do
    config = TeamsConfig.new([ { "org" => "acme", "team_slug" => "platform" } ])
    assert config.entries.frozen?
  end

  test "strips surrounding whitespace" do
    config = TeamsConfig.new([ { "org" => "  acme ", "team_slug" => "platform\n" } ])
    assert_equal "acme",     config.entries.first.org
    assert_equal "platform", config.entries.first.slug
  end

  test "accepts an empty list" do
    config = TeamsConfig.new([])
    assert_empty config.entries
  end

  test "rejects a non-list top-level value" do
    assert_raises(TeamsConfig::InvalidConfig) { TeamsConfig.new("nope") }
    assert_raises(TeamsConfig::InvalidConfig) { TeamsConfig.new({ "teams" => [] }) }
  end

  test "rejects an entry that is not a mapping" do
    assert_raises(TeamsConfig::InvalidConfig) { TeamsConfig.new([ "acme/platform" ]) }
  end

  test "rejects a missing org" do
    error = assert_raises(TeamsConfig::InvalidConfig) do
      TeamsConfig.new([ { "team_slug" => "platform" } ])
    end
    assert_match(/missing org/, error.message)
  end

  test "rejects a missing team_slug" do
    error = assert_raises(TeamsConfig::InvalidConfig) do
      TeamsConfig.new([ { "org" => "acme" } ])
    end
    assert_match(/missing team_slug/, error.message)
  end

  test "rejects a blank org" do
    assert_raises(TeamsConfig::InvalidConfig) do
      TeamsConfig.new([ { "org" => "  ", "team_slug" => "platform" } ])
    end
  end

  test "rejects duplicate entries" do
    error = assert_raises(TeamsConfig::InvalidConfig) do
      TeamsConfig.new([
        { "org" => "acme", "team_slug" => "platform" },
        { "org" => "acme", "team_slug" => "platform" }
      ])
    end
    assert_match(/duplicate/, error.message)
  end

  test "allows the same slug under a different org" do
    config = TeamsConfig.new([
      { "org" => "acme", "team_slug" => "platform" },
      { "org" => "beta", "team_slug" => "platform" }
    ])
    assert_equal 2, config.entries.size
  end

  test "load reads a YAML file from disk" do
    Tempfile.create([ "teams", ".yml" ]) do |f|
      f.write(<<~YAML)
        - org: acme
          team_slug: platform
        - org: beta
          team_slug: sre
      YAML
      f.flush
      config = TeamsConfig.load(f.path)
      assert_equal [ [ "acme", "platform" ], [ "beta", "sre" ] ], config.entries.map { |e| [ e.org, e.slug ] }
    end
  end

  test "load treats an empty file as an empty list" do
    Tempfile.create([ "teams", ".yml" ]) do |f|
      f.flush
      config = TeamsConfig.load(f.path)
      assert_empty config.entries
    end
  end
end

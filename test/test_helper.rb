$LOAD_PATH.unshift File.expand_path("../lib", __dir__)

require "active_support/all"
require "active_support/test_case"
require "minitest/autorun"
require "webmock/minitest"

require "octladder/period"
require "octladder/ranking"
require "octladder/github_client"
require "octladder/teams_config"

Time.zone = ENV.fetch("OCTLADDER_TIME_ZONE", "Asia/Tokyo")

WebMock.disable_net_connect!(allow_localhost: true)

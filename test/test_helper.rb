$LOAD_PATH.unshift File.expand_path("../lib", __dir__)

require "active_support/all"
require "active_support/test_case"
require "minitest/autorun"
require "webmock/minitest"

require "octoladder/period"
require "octoladder/ranking"
require "octoladder/github_client"
require "octoladder/teams_config"

Time.zone = ENV.fetch("OCTOLADDER_TIME_ZONE", "Asia/Tokyo")

WebMock.disable_net_connect!(allow_localhost: true)

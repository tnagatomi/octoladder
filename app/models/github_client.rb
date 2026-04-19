require "octokit"

class GithubClient
  class MissingToken < ArgumentError; end
  class InvalidLogin < ArgumentError; end
  class ResultsTruncated < StandardError; end

  LOGIN_PATTERN     = /\A[a-zA-Z0-9][a-zA-Z0-9-]{0,38}\z/
  SEARCH_RESULT_CAP = 1000

  def self.from_env
    token = ENV["GITHUB_TOKEN"].to_s.strip
    raise MissingToken, "GITHUB_TOKEN is not set" if token.empty?
    new(token: token)
  end

  def initialize(token:)
    @client = Octokit::Client.new(access_token: token, auto_paginate: true, per_page: 100)
  end

  def team_members(org, slug)
    @client.paginate("/orgs/#{org}/teams/#{slug}/members").map do |user|
      { github_id: user.id, login: user.login, avatar_url: user.avatar_url }
    end
  end

  # from is inclusive, to is exclusive (matches Period's half-open interval).
  def merged_prs(login, from:, to:)
    raise InvalidLogin, "invalid GitHub login: #{login.inspect}" unless LOGIN_PATTERN.match?(login)

    range  = "#{from.utc.iso8601}..#{(to.utc - 1.second).iso8601}"
    result = @client.search_issues("is:pr is:merged is:public author:#{login} merged:#{range}")

    if result.total_count > SEARCH_RESULT_CAP
      raise ResultsTruncated, "GitHub search returned #{result.total_count} results for #{login}, exceeding the 1000-result cap"
    end

    result.items.map do |item|
      {
        github_id:      item.id,
        merged_at:      item.pull_request.merged_at,
        html_url:       item.html_url,
        repo_full_name: Octokit::Repository.from_url(item.repository_url).slug
      }
    end
  end
end

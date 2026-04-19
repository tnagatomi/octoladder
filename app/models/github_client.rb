require "octokit"

# Thin wrapper over Octokit that exposes only the endpoints Octladder needs
# and converts Sawyer::Resource responses into plain symbol-keyed hashes so
# the rest of the app never touches Octokit types.
class GithubClient
  class MissingToken < StandardError; end

  def self.from_env
    token = ENV["GITHUB_TOKEN"].to_s.strip
    raise MissingToken, "GITHUB_TOKEN is not set" if token.empty?
    new(token: token)
  end

  def initialize(token:)
    @client = Octokit::Client.new(access_token: token, auto_paginate: true, per_page: 100)
  end

  def team_members(org, slug)
    @client.paginate("/orgs/#{org}/teams/#{slug}/members", per_page: 100).map do |user|
      { github_id: user.id, login: user.login, avatar_url: user.avatar_url }
    end
  end

  # from is inclusive, to is exclusive (matches Period's half-open interval).
  # GitHub's merged: filter is inclusive on both ends, so we subtract a second.
  def merged_prs(login, from:, to:)
    range = "#{from.utc.iso8601}..#{(to.utc - 1.second).iso8601}"
    query = %(is:pr is:merged is:public author:#{login} merged:#{range})

    @client.search_issues(query).items.map do |item|
      {
        github_id:       item.id,
        merged_at:       item.pull_request.merged_at,
        html_url:        item.html_url,
        repo_full_name:  item.repository_url.split("/").last(2).join("/")
      }
    end
  end
end

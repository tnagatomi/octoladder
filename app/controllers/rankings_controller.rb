class RankingsController < ApplicationController
  FAKE_USERS = [
    { login: "ayanami-r",   name: "Ryosuke Ayanami",   color: "#e9b872" },
    { login: "ernestina",   name: "Ernestina Vogel",   color: "#8fa7f5" },
    { login: "k-saotome",   name: "Kaede Saotome",     color: "#d58aa1" },
    { login: "bashouba",    name: "Basho Banana",      color: "#7ad1a8" },
    { login: "matsumoto-k", name: "Ken Matsumoto",     color: "#b89fe0" },
    { login: "octonight",   name: "Octavia Knight",    color: "#f09874" },
    { login: "rgx-devil",   name: "Rei Goto",          color: "#6bc3c3" },
    { login: "yuki-mori",   name: "Yuki Morimoto",     color: "#c9b88b" },
    { login: "tsubaki-ll",  name: "Tsubaki Llewelyn",  color: "#e9b872" },
    { login: "hoshinomk",   name: "Maiko Hoshino",     color: "#7ad1a8" }
  ].freeze

  BUCKET_COUNTS = { weekly: 7, monthly: 4, yearly: 12 }.freeze

  def weekly
    render_ranking(:weekly)
  end

  def monthly
    render_ranking(:monthly)
  end

  def yearly
    render_ranking(:yearly)
  end

  private

  def render_ranking(type)
    @type    = type
    @period  = params[:id].present? ? Period.parse(type, params[:id]) : Period.latest_closed(type)
    @ranking = Ranking.new(fake_entries_for(@period))
    render :show
  rescue Period::InvalidParam
    head :not_found
  end

  def fake_entries_for(period)
    FAKE_USERS.map do |user|
      buckets = fake_buckets(period, user)
      { user: user, count: buckets.sum, buckets: buckets }
    end
  end

  # Deterministic per (period, user) so navigation is stable across requests.
  def fake_buckets(period, user)
    rng = Random.new("#{period.to_param}-#{user[:login]}".hash.abs)
    Array.new(BUCKET_COUNTS[period.type]) { rng.rand(0..3) }
  end
end

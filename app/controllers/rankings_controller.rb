class RankingsController < ApplicationController
  FAKE_ROWS = [
    { login: "ayanami-r",   name: "Ryosuke Ayanami",   daily: [3, 4, 2, 3, 1, 1, 1], color: "#e9b872" },
    { login: "ernestina",   name: "Ernestina Vogel",   daily: [2, 2, 3, 2, 1, 1, 0], color: "#8fa7f5" },
    { login: "k-saotome",   name: "Kaede Saotome",     daily: [1, 2, 1, 2, 1, 0, 1], color: "#d58aa1" },
    { login: "bashouba",    name: "Basho Banana",      daily: [0, 1, 2, 1, 2, 1, 1], color: "#7ad1a8" },
    { login: "matsumoto-k", name: "Ken Matsumoto",     daily: [2, 1, 1, 1, 1, 0, 1], color: "#b89fe0" },
    { login: "octonight",   name: "Octavia Knight",    daily: [1, 1, 1, 1, 0, 1, 0], color: "#f09874" },
    { login: "rgx-devil",   name: "Rei Goto",          daily: [1, 0, 1, 1, 1, 0, 0], color: "#6bc3c3" },
    { login: "yuki-mori",   name: "Yuki Morimoto",     daily: [0, 1, 1, 0, 1, 1, 0], color: "#c9b88b" },
    { login: "tsubaki-ll",  name: "Tsubaki Llewelyn",  daily: [0, 1, 0, 1, 0, 1, 0], color: "#e9b872" },
    { login: "hoshinomk",   name: "Maiko Hoshino",     daily: [0, 0, 0, 1, 0, 0, 0], color: "#7ad1a8" }
  ].freeze

  def weekly
    @period_label = "April 6 — April 12"
    @period_sub   = "Week 15 · 2026"
    @prev_label   = "Week 14"
    @next_label   = "Week 16"
    @next_disabled = true

    rows = FAKE_ROWS.map { |r| r.merge(count: r[:daily].sum) }
    @rows = assign_competitive_ranks(rows)
    @total_prs = rows.sum { |r| r[:count] }
    @contributor_count = rows.count { |r| r[:count] > 0 }
  end

  private

  # Competitive rank: ties share the rank, next rank skips (1, 1, 3, ...).
  def assign_competitive_ranks(rows)
    sorted = rows.sort_by { |r| -r[:count] }
    ranked = []
    sorted.each_with_index do |row, idx|
      rank = if idx > 0 && row[:count] == ranked.last[:count]
        ranked.last[:rank]
      else
        idx + 1
      end
      ranked << row.merge(rank: rank)
    end
    ranked
  end
end

class Ranking
  Row = Data.define(:rank, :user, :count, :buckets)

  def initialize(entries)
    @entries = Array(entries).map(&:to_h)
  end

  def rows
    @rows ||= compute
  end

  def total_count
    rows.sum(&:count)
  end

  def contributor_count
    rows.size
  end

  def empty?
    rows.empty?
  end

  private

  # Competitive rank: ties share their position, the next rank skips (1, 1, 3, ...).
  # Zero-count entries are omitted.
  def compute
    sorted = @entries
      .reject { |e| e[:count].to_i.zero? }
      .sort_by { |e| -e[:count].to_i }

    sorted.each_with_index.with_object([]) do |(entry, idx), ranked|
      rank = idx.positive? && entry[:count] == ranked.last.count ? ranked.last.rank : idx + 1
      ranked << Row.new(rank:, user: entry[:user], count: entry[:count], buckets: entry[:buckets] || [])
    end
  end
end

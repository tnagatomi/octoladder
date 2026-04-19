require "test_helper"

class RankingTest < ActiveSupport::TestCase
  test "assigns competitive ranks: ties share, next rank skips" do
    ranking = Ranking.new([
      {user: :a, count: 5},
      {user: :b, count: 3},
      {user: :c, count: 3},
      {user: :d, count: 2}
    ])
    assert_equal [1, 2, 2, 4], ranking.rows.map(&:rank)
    assert_equal [:a, :b, :c, :d], ranking.rows.map(&:user)
  end

  test "three-way tie gives everyone rank 1" do
    ranking = Ranking.new([
      {user: :a, count: 2},
      {user: :b, count: 2},
      {user: :c, count: 2}
    ])
    assert_equal [1, 1, 1], ranking.rows.map(&:rank)
  end

  test "two leaders tie at rank 1 and next rank is 3" do
    ranking = Ranking.new([
      {user: :a, count: 5},
      {user: :b, count: 5},
      {user: :c, count: 4}
    ])
    assert_equal [1, 1, 3], ranking.rows.map(&:rank)
  end

  test "omits zero-count entries" do
    ranking = Ranking.new([
      {user: :a, count: 0},
      {user: :b, count: 3},
      {user: :c, count: 0}
    ])
    assert_equal [:b], ranking.rows.map(&:user)
    assert_equal [1], ranking.rows.map(&:rank)
    assert_equal 1, ranking.contributor_count
  end

  test "empty input yields empty rows" do
    ranking = Ranking.new([])
    assert ranking.empty?
    assert_equal 0, ranking.total_count
    assert_equal 0, ranking.contributor_count
  end

  test "orders by count descending" do
    ranking = Ranking.new([
      {user: :a, count: 1},
      {user: :b, count: 10},
      {user: :c, count: 5}
    ])
    assert_equal [:b, :c, :a], ranking.rows.map(&:user)
  end

  test "total_count sums visible entries only" do
    ranking = Ranking.new([
      {user: :a, count: 5},
      {user: :b, count: 3},
      {user: :c, count: 0}
    ])
    assert_equal 8, ranking.total_count
  end

  test "preserves opaque buckets metadata on each row" do
    ranking = Ranking.new([{user: :a, count: 5, buckets: [1, 2, 3]}])
    assert_equal [1, 2, 3], ranking.rows.first.buckets
  end

  test "missing buckets default to empty array" do
    ranking = Ranking.new([{user: :a, count: 5}])
    assert_equal [], ranking.rows.first.buckets
  end

  test "passes through arbitrary user object" do
    user = {login: "octocat", name: "The Octocat"}
    ranking = Ranking.new([{user: user, count: 1}])
    assert_equal user, ranking.rows.first.user
  end
end

require "test_helper"

class PeriodTest < ActiveSupport::TestCase
  # Rails config sets Time.zone to Asia/Tokyo (see config/application.rb).

  test "weekly latest_closed returns the previous Mon-Sun week in the configured TZ" do
    # Sun 2026-04-19 23:00 JST -> previous completed week = Mon 4/6 .. Sun 4/12
    now = Time.zone.local(2026, 4, 19, 23)
    period = Period.latest_closed(:weekly, now: now)
    assert_equal :weekly, period.type
    assert_equal Time.zone.local(2026, 4, 6), period.starts_at
    assert_equal Time.zone.local(2026, 4, 13), period.ends_at
  end

  test "weekly latest_closed on a Monday morning returns the week that just ended" do
    now = Time.zone.local(2026, 4, 13, 0, 0, 1) # Mon 00:00:01 JST
    period = Period.latest_closed(:weekly, now: now)
    assert_equal Time.zone.local(2026, 4, 6), period.starts_at
  end

  test "monthly latest_closed returns the previous calendar month" do
    now = Time.zone.local(2026, 4, 19)
    period = Period.latest_closed(:monthly, now: now)
    assert_equal Time.zone.local(2026, 3, 1), period.starts_at
    assert_equal Time.zone.local(2026, 4, 1), period.ends_at
  end

  test "yearly latest_closed returns the previous calendar year" do
    now = Time.zone.local(2026, 4, 19)
    period = Period.latest_closed(:yearly, now: now)
    assert_equal Time.zone.local(2025, 1, 1), period.starts_at
    assert_equal Time.zone.local(2026, 1, 1), period.ends_at
  end

  test "weekly prev/next step exactly 7 days" do
    period = Period.new(type: :weekly, starts_at: Time.zone.local(2026, 4, 6))
    assert_equal Time.zone.local(2026, 3, 30), period.prev.starts_at
    assert_equal Time.zone.local(2026, 4, 13), period.next.starts_at
  end

  test "monthly prev/next step by calendar month (handles month lengths)" do
    period = Period.new(type: :monthly, starts_at: Time.zone.local(2026, 3, 1))
    assert_equal Time.zone.local(2026, 2, 1), period.prev.starts_at
    assert_equal Time.zone.local(2026, 4, 1), period.next.starts_at
  end

  test "yearly prev/next step by calendar year" do
    period = Period.new(type: :yearly, starts_at: Time.zone.local(2025, 1, 1))
    assert_equal Time.zone.local(2024, 1, 1), period.prev.starts_at
    assert_equal Time.zone.local(2026, 1, 1), period.next.starts_at
  end

  test "complete? is true when ends_at is at or before now" do
    period = Period.new(type: :weekly, starts_at: Time.zone.local(2026, 4, 6))
    assert period.complete?(now: Time.zone.local(2026, 4, 13))
    refute period.complete?(now: Time.zone.local(2026, 4, 12, 23, 59, 59))
  end

  test "contains? uses half-open interval [starts_at, ends_at)" do
    period = Period.new(type: :weekly, starts_at: Time.zone.local(2026, 4, 6))
    assert period.contains?(Time.zone.local(2026, 4, 6))
    assert period.contains?(Time.zone.local(2026, 4, 12, 23, 59, 59))
    refute period.contains?(Time.zone.local(2026, 4, 13))
    refute period.contains?(Time.zone.local(2026, 4, 5, 23, 59, 59))
  end

  test "labels are human readable" do
    assert_equal "April 6 — April 12",
                 Period.new(type: :weekly,  starts_at: Time.zone.local(2026, 4, 6)).label
    assert_equal "March 2026",
                 Period.new(type: :monthly, starts_at: Time.zone.local(2026, 3, 1)).label
    assert_equal "2025",
                 Period.new(type: :yearly,  starts_at: Time.zone.local(2025, 1, 1)).label
  end

  test "weekly subtitle reports ISO week" do
    period = Period.new(type: :weekly, starts_at: Time.zone.local(2026, 4, 6))
    assert_equal "Week 15 · 2026", period.subtitle
  end

  test "non-weekly subtitle is nil" do
    assert_nil Period.new(type: :monthly, starts_at: Time.zone.local(2026, 3, 1)).subtitle
    assert_nil Period.new(type: :yearly,  starts_at: Time.zone.local(2025, 1, 1)).subtitle
  end

  test "to_param round-trips through parse for every type" do
    [
      Period.new(type: :weekly,  starts_at: Time.zone.local(2026, 4, 6)),
      Period.new(type: :monthly, starts_at: Time.zone.local(2026, 3, 1)),
      Period.new(type: :yearly,  starts_at: Time.zone.local(2025, 1, 1))
    ].each do |period|
      parsed = Period.parse(period.type, period.to_param)
      assert_equal period, parsed, "round-trip failed for #{period.type}"
    end
  end

  test "parse rejects malformed params" do
    assert_raises(Period::InvalidParam) { Period.parse(:weekly,  "2026W15") }
    assert_raises(Period::InvalidParam) { Period.parse(:weekly,  "2026-15") }
    assert_raises(Period::InvalidParam) { Period.parse(:monthly, "2026/04") }
    assert_raises(Period::InvalidParam) { Period.parse(:yearly,  "20xx") }
  end

  test "parse rejects impossible ISO week numbers" do
    # 2026 has 53 ISO weeks? Actually 2026 has 53 weeks only if Jan 1 is Thu (or leap year + Wed).
    # 2026-01-01 is Thursday so it does have 53. Use a year known to have 52.
    # 2025-01-01 is Wednesday -> 2025 has 52 weeks.
    assert_raises(Period::InvalidParam) { Period.parse(:weekly, "2025-W53") }
  end

  test "mid-period starts_at is normalized to the canonical start" do
    period = Period.new(type: :weekly, starts_at: Time.zone.local(2026, 4, 10, 15))
    assert_equal Time.zone.local(2026, 4, 6), period.starts_at
  end

  test "initialize rejects unknown types" do
    assert_raises(ArgumentError) { Period.new(type: :daily, starts_at: Time.zone.local(2026, 4, 6)) }
  end

  test "equality and hash consistency" do
    a = Period.new(type: :weekly, starts_at: Time.zone.local(2026, 4, 6))
    b = Period.new(type: :weekly, starts_at: Time.zone.local(2026, 4, 6))
    c = Period.new(type: :weekly, starts_at: Time.zone.local(2026, 4, 13))
    assert_equal a, b
    assert_equal a.hash, b.hash
    refute_equal a, c
  end
end

require "test_helper"

class RankingsControllerTest < ActionDispatch::IntegrationTest
  test "weekly without id uses the latest closed week" do
    travel_to Time.zone.local(2026, 4, 15, 10) do
      get weekly_ranking_path
      assert_response :success
      latest = Period.latest_closed(:weekly)
      assert_select "a[href=?]", weekly_ranking_path(id: latest.prev.to_param)
    end
  end

  test "monthly without id uses the latest closed month" do
    travel_to Time.zone.local(2026, 4, 15, 10) do
      get monthly_ranking_path
      assert_response :success
      latest = Period.latest_closed(:monthly)
      assert_select "a[href=?]", monthly_ranking_path(id: latest.prev.to_param)
    end
  end

  test "yearly without id uses the latest closed year" do
    travel_to Time.zone.local(2026, 4, 15, 10) do
      get yearly_ranking_path
      assert_response :success
      latest = Period.latest_closed(:yearly)
      assert_select "a[href=?]", yearly_ranking_path(id: latest.prev.to_param)
    end
  end

  test "weekly with id parses the given week and links to its neighbors" do
    get weekly_ranking_path(id: "2026-W10")
    assert_response :success
    period = Period.parse(:weekly, "2026-W10")
    assert_select "a[href=?]", weekly_ranking_path(id: period.prev.to_param)
    assert_select "a[href=?]", weekly_ranking_path(id: period.next.to_param)
  end

  test "monthly with id parses the given month and links to its neighbors" do
    get monthly_ranking_path(id: "2026-02")
    assert_response :success
    period = Period.parse(:monthly, "2026-02")
    assert_select "a[href=?]", monthly_ranking_path(id: period.prev.to_param)
    assert_select "a[href=?]", monthly_ranking_path(id: period.next.to_param)
  end

  test "yearly with id parses the given year and links to its neighbors" do
    get yearly_ranking_path(id: "2024")
    assert_response :success
    period = Period.parse(:yearly, "2024")
    assert_select "a[href=?]", yearly_ranking_path(id: period.prev.to_param)
    assert_select "a[href=?]", yearly_ranking_path(id: period.next.to_param)
  end

  test "weekly with malformed id returns 404" do
    get weekly_ranking_path(id: "not-a-week")
    assert_response :not_found
  end

  test "monthly with malformed id returns 404" do
    get monthly_ranking_path(id: "2026-13")
    assert_response :not_found
  end

  test "yearly with malformed id returns 404" do
    get yearly_ranking_path(id: "abcd")
    assert_response :not_found
  end

  test "weekly with impossible ISO week returns 404" do
    get weekly_ranking_path(id: "2026-W99")
    assert_response :not_found
  end

  test "disables next link when the next period is still open" do
    travel_to Time.zone.local(2026, 4, 15, 10) do
      get weekly_ranking_path
      assert_response :success
      latest_next_param = Period.latest_closed(:weekly).next.to_param
      assert_select "a[href=?]", weekly_ranking_path(id: latest_next_param), count: 0
    end
  end

  test "enables next link when the next period is already closed" do
    get weekly_ranking_path(id: "2026-W10")
    assert_response :success
    period = Period.parse(:weekly, "2026-W10")
    assert_select "a[href=?]", weekly_ranking_path(id: period.next.to_param)
  end

  test "active tab reflects the current type" do
    get monthly_ranking_path
    assert_response :success
    assert_select "nav a.font-semibold", text: "Monthly"
  end

  test "root routes to weekly" do
    get root_path
    assert_response :success
    assert_select "h1", text: /Weekly/
  end
end

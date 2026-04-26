require "erb"
require "fileutils"
require "time"
require "octoladder/period"
require "octoladder/ranking"

class Site
  TEMPLATES_DIR = File.expand_path("../../views", __dir__)

  def initialize(state:, output_dir:, now: Time.now)
    @state = state
    @output_dir = output_dir
    @now = now
    @users_by_login = state.users.to_h { |u| [ u["login"], u ] }
    @parsed_prs = state.pull_requests.map do |pr|
      { author: pr["author_login"], merged_at: Time.iso8601(pr["merged_at"]) }
    end
    @erb_cache = {}
  end

  def call
    enumerated = Period::TYPES.to_h { |type| [ type, enumerate_periods(type) ] }
    enumerated.each_value do |periods|
      ([ nil ] + periods + [ nil ]).each_cons(3) do |prev_period, period, next_period|
        render_period(period, prev_period, next_period)
      end
    end
    render_index(enumerated[:weekly].last)
    copy_assets
    enumerated
  end

  def enumerate_periods(type)
    return [] if @state.backfill_anchor.nil?

    first = Period.new(type: type, starts_at: @state.backfill_anchor)
    last = Period.latest_closed(type, now: @now)
    return [] if first.starts_at > last.starts_at

    periods = []
    current = first
    while current.starts_at <= last.starts_at
      periods << current
      current = current.next
    end
    periods
  end

  private

  def render_period(period, prev_period, next_period)
    entries = pr_counts_for(period).map do |login, count|
      user = @users_by_login[login] || { "login" => login }
      { user: user, count: count, buckets: [] }
    end
    ranking = Ranking.new(entries)

    html = render_with_layout(
      "period",
      title: period.label,
      asset_prefix: "../",
      period: period,
      ranking: ranking,
      prev_period: prev_period,
      next_period: next_period
    )
    write_file(File.join(period.type.to_s, "#{period.to_param}.html"), html)
  end

  def render_index(latest_weekly)
    target = latest_weekly ? "weekly/#{latest_weekly.to_param}.html" : nil
    write_file("index.html", index_body(target))
  end

  def index_body(target)
    return <<~HTML unless target
      <!DOCTYPE html>
      <html lang="en">
      <head><meta charset="UTF-8"><title>Octoladder</title></head>
      <body><p>No data yet. Run a sync.</p></body>
      </html>
    HTML

    <<~HTML
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>Octoladder</title>
        <meta http-equiv="refresh" content="0; url=#{target}">
      </head>
      <body>
        <p>Redirecting to <a href="#{target}">#{target}</a>…</p>
      </body>
      </html>
    HTML
  end

  def pr_counts_for(period)
    @parsed_prs
      .select { |pr| period.contains?(pr[:merged_at]) }
      .map { |pr| pr[:author] }
      .tally
  end

  def render_with_layout(template_name, locals)
    body = render_template(template_name, locals)
    render_template("layout", locals.merge(body: body))
  end

  def render_template(name, locals)
    erb = (@erb_cache[name] ||= ERB.new(
      File.read(File.join(TEMPLATES_DIR, "#{name}.html.erb")),
      trim_mode: "-"
    ))
    erb.result(TemplateContext.new(locals).binding_for_template)
  end

  def copy_assets
    src = File.join(TEMPLATES_DIR, "assets")
    return unless File.directory?(src)
    dst = File.join(@output_dir, "assets")
    FileUtils.mkdir_p(dst)
    FileUtils.cp_r(File.join(src, "."), dst)
  end

  def write_file(rel_path, content)
    full = File.join(@output_dir, rel_path)
    FileUtils.mkdir_p(File.dirname(full))
    File.write(full, content)
  end

  class TemplateContext
    def initialize(locals)
      locals.each { |k, v| instance_variable_set("@#{k}", v) }
    end

    def binding_for_template
      binding
    end
  end
end

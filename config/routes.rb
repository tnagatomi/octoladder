Rails.application.routes.draw do
  get "up" => "rails/health#show", as: :rails_health_check

  scope "rankings" do
    get "weekly(/:id)",  to: "rankings#weekly",  as: :weekly_ranking
    get "monthly(/:id)", to: "rankings#monthly", as: :monthly_ranking
    get "yearly(/:id)",  to: "rankings#yearly",  as: :yearly_ranking
  end

  root "rankings#weekly"
end

class Team < ApplicationRecord
  has_many :team_memberships, dependent: :destroy
  has_many :users, through: :team_memberships

  validates :org_login, presence: true
  validates :slug,      presence: true, uniqueness: { scope: :org_login }
end

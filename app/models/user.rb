class User < ApplicationRecord
  has_many :team_memberships, dependent: :destroy
  has_many :teams, through: :team_memberships

  validates :github_id, presence: true, uniqueness: true
  validates :login,     presence: true, uniqueness: true
end

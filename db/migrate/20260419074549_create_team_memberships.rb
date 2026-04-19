class CreateTeamMemberships < ActiveRecord::Migration[8.1]
  def change
    create_table :team_memberships do |t|
      t.references :team, null: false, foreign_key: true
      t.references :user, null: false, foreign_key: true

      t.timestamps
    end
    add_index :team_memberships, [ :team_id, :user_id ], unique: true
  end
end

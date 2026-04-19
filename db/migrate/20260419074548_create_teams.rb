class CreateTeams < ActiveRecord::Migration[8.1]
  def change
    create_table :teams do |t|
      t.string :org_login, null: false
      t.string :slug,      null: false
      t.string :name

      t.timestamps
    end
    add_index :teams, [ :org_login, :slug ], unique: true
  end
end

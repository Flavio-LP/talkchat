class CreateTurns < ActiveRecord::Migration[8.0]
  def change
    create_table :turns do |t|
      t.references :conversation, null: false, foreign_key: true
      t.text  :user_text,      null: false
      t.text  :corrected_text
      t.jsonb :issues,         null: false, default: []
      t.text  :reply
      # text, not string: praise is free-form LLM output. A varchar(255) overflow
      # would raise ValueTooLong *after* the Gemini call was already paid for.
      t.text  :praise,         null: false, default: ""

      t.timestamps
    end
  end
end

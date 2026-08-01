class AddReplyTranslationAndStructureToTurns < ActiveRecord::Migration[8.0]
  def change
    add_column :turns, :reply_translation, :text
    add_column :turns, :reply_structure, :text
  end
end

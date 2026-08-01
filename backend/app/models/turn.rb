class Turn < ApplicationRecord
  belongs_to :conversation

  validates :user_text, presence: true
end

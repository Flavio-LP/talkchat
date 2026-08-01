class Conversation < ApplicationRecord
  has_many :turns, -> { order(created_at: :asc) }, dependent: :destroy
end

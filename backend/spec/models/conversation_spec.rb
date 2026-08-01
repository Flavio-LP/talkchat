require "rails_helper"

RSpec.describe Conversation do
  it "is valid with no attributes" do
    expect(described_class.new).to be_valid
  end

  describe "#turns" do
    it "returns turns oldest first" do
      conversation = create(:conversation)
      older = create(:turn, conversation: conversation, created_at: 2.minutes.ago)
      newer = create(:turn, conversation: conversation, created_at: 1.minute.ago)

      expect(conversation.turns.to_a).to eq([ older, newer ])
    end

    it "destroys its turns when destroyed" do
      conversation = create(:conversation)
      create(:turn, conversation: conversation)

      expect { conversation.destroy! }.to change(Turn, :count).by(-1)
    end
  end
end

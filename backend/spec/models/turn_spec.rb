require "rails_helper"

RSpec.describe Turn do
  it "requires a conversation" do
    turn = described_class.new(user_text: "hello")

    expect(turn).not_to be_valid
    expect(turn.errors[:conversation]).to be_present
  end

  it "requires user_text" do
    turn = build(:turn, user_text: "")

    expect(turn).not_to be_valid
    expect(turn.errors[:user_text]).to be_present
  end

  it "defaults issues to an empty array" do
    turn = create(:conversation).turns.create!(user_text: "hello")

    expect(turn.reload.issues).to eq([])
  end

  it "defaults praise to an empty string" do
    turn = create(:conversation).turns.create!(user_text: "hello")

    expect(turn.reload.praise).to eq("")
  end

  it "stores a praise longer than 255 characters (text, not varchar)" do
    long_praise = "ótimo! " * 100
    turn = create(:turn, praise: long_praise)

    expect(turn.reload.praise).to eq(long_praise)
  end
end

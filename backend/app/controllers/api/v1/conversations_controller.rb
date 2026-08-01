module Api
  module V1
    class ConversationsController < BaseController
      # POST /api/v1/conversations
      def create
        conversation = Conversation.create!
        render json: { id: conversation.id }, status: :created
      end

      # DELETE /api/v1/conversations/:id
      def destroy
        Conversation.find(params[:id]).destroy!
        head :no_content
      end
    end
  end
end

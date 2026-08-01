module Api
  module V1
    class TurnsController < BaseController
      before_action :set_conversation

      # GET /api/v1/conversations/:conversation_id/turns
      #
      # cache_key_with_version (not [id, maximum(:updated_at)]) because Rails
      # expands key elements with #to_s, and TimeWithZone#to_s has second
      # precision — two turns created within the same second would collide and
      # serve a stale list. cache_key_with_version includes count + nanosecond
      # timestamp, so invalidation is automatic and no cache.delete is needed.
      def index
        payload = Rails.cache.fetch([ "turns", @conversation.turns.cache_key_with_version ]) do
          @conversation.turns.map { |turn| turn_json(turn) }
        end

        render json: payload, status: :ok
      end

      # POST /api/v1/conversations/:conversation_id/turns
      def create
        text = params[:text].to_s.strip

        if text.blank?
          # 422 before any AI call — an empty transcript costs quota for nothing.
          return render json: { error: "Diga alguma coisa antes de enviar." },
                        status: :unprocessable_content
        end

        analysis = TutorService.new(@conversation, text).call

        turn = @conversation.turns.create!(
          user_text: text,
          corrected_text: analysis[:corrected_text],
          issues: analysis[:issues],
          reply: analysis[:reply],
          reply_translation: analysis[:reply_translation],
          reply_structure: analysis[:reply_structure],
          praise: analysis[:praise]
        )

        render json: turn_json(turn), status: :created
      rescue TutorService::ConfigurationError => e
        # Missing GEMINI_API_KEY is an operator problem, not an AI outage.
        Rails.logger.error("[TutorService] configuration error: #{e.message}")
        render json: { error: "Servidor mal configurado: a chave da IA não foi definida." },
               status: :internal_server_error
      rescue TutorService::TutorError => e
        # e.message may carry URL/body fragments from the provider — log it, do
        # not ship it to the browser.
        Rails.logger.error("[TutorService] #{e.class}: #{e.message}")

        if e.rate_limited?
          render json: { error: "Muitas mensagens seguidas. Espere alguns segundos e tente de novo." },
                 status: :too_many_requests
        else
          render json: { error: "A professora está indisponível agora. Tente novamente em instantes." },
                 status: :bad_gateway
        end
      end

      private

      def set_conversation
        @conversation = Conversation.find(params[:conversation_id])
      end

      def turn_json(turn)
        {
          id: turn.id,
          user_text: turn.user_text,
          corrected_text: turn.corrected_text,
          issues: turn.issues,
          reply: turn.reply,
          reply_translation: turn.reply_translation,
          reply_structure: turn.reply_structure,
          praise: turn.praise,
          created_at: turn.created_at
        }
      end
    end
  end
end

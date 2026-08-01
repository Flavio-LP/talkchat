require "digest"

module Api
  module V1
    class BaseController < ActionController::API
      before_action :authenticate!

      rescue_from ActiveRecord::RecordNotFound, with: :render_not_found

      private

      # Single shared secret, not per-user auth: this app has one owner. A
      # missing/blank APP_ACCESS_TOKEN fails the digest comparison the same
      # way a wrong token would, so a misconfigured server denies everyone
      # instead of accidentally opening up.
      def authenticate!
        provided = extract_token(request.headers["Authorization"])
        expected = ENV["APP_ACCESS_TOKEN"].to_s

        return if provided.present? && ActiveSupport::SecurityUtils.secure_compare(
          Digest::SHA256.hexdigest(provided),
          Digest::SHA256.hexdigest(expected)
        )

        render json: { error: "Não autorizado." }, status: :unauthorized
      end

      def extract_token(header)
        return nil unless header

        scheme, token = header.split(" ", 2)
        token if scheme == "Bearer"
      end

      def render_not_found
        render json: { error: "Conversa não encontrada." }, status: :not_found
      end
    end
  end
end

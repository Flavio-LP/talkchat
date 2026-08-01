FactoryBot.define do
  factory :turn do
    conversation
    user_text      { "I have went to school yesterday" }
    corrected_text { "I went to school yesterday." }
    issues do
      [
        {
          "original" => "have went",
          "fixed" => "went",
          "type" => "Tempo verbal",
          "explanation" => "Com 'yesterday' usamos o past simple."
        }
      ]
    end
    reply             { "Nice! What did you do at school yesterday?" }
    reply_translation { "Legal! O que você fez na escola ontem?" }
    reply_structure   { "Passado simples com 'do' -> 'did', pergunta com inversão sujeito-verbo." }
    praise            { "" }
  end
end

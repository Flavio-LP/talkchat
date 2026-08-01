/**
 * One analysed utterance.
 *
 * Every field here is LLM output derived from user input, so it is rendered as
 * text only — never dangerouslySetInnerHTML. React's default escaping is the
 * whole XSS defence.
 */
export default function TurnCard({ turn }) {
  const issues = Array.isArray(turn.issues) ? turn.issues : []
  const hasIssues = issues.length > 0

  return (
    <article className="turn-card">
      <p className="turn-card__said">
        <span className="turn-card__label">Você disse</span>
        {turn.user_text}
      </p>

      {turn.corrected_text && turn.corrected_text !== turn.user_text && (
        <p className="turn-card__corrected">
          <span className="turn-card__label">Versão corrigida</span>
          {turn.corrected_text}
        </p>
      )}

      {hasIssues ? (
        <ul className="turn-card__issues">
          {issues.map((issue, index) => (
            <li key={`${issue.original}-${index}`} className="turn-card__issue">
              <p className="turn-card__fix">
                <s>{issue.original}</s>
                {' → '}
                <strong>{issue.fixed}</strong>
                {issue.type && <em className="turn-card__type">{issue.type}</em>}
              </p>
              {issue.explanation && (
                <p className="turn-card__explanation">{issue.explanation}</p>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="turn-card__clean">Nenhum erro encontrado nessa frase.</p>
      )}

      {turn.praise && <p className="turn-card__praise">{turn.praise}</p>}

      {turn.reply && (
        <div className="turn-card__reply">
          <p>
            <span className="turn-card__label">Teacher</span>
            {turn.reply}
          </p>
          {turn.reply_translation && (
            <p className="turn-card__reply-translation">{turn.reply_translation}</p>
          )}
          {turn.reply_structure && (
            <p className="turn-card__reply-structure">🧩 {turn.reply_structure}</p>
          )}
        </div>
      )}
    </article>
  )
}

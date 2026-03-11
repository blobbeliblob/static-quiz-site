# QuizURL

Create and share fully static quizzes using a single URL. 

QuizURL stores the entire quiz payload in the hash part of the URL. There is no backend, no database, and no login flow.

Available at [quizurl.eu](https://quizurl.eu)

For questions/feedback, feel free to email `camilo@cmlo.dev`

## Features

- Build quizzes in-browser with a visual creator.
- Share quizzes as one compressed URL.
- Play quizzes directly from the shared link.

## Question Types

- `text`: one or more accepted text answers, optional case sensitivity.
- `numerical`: one or more accepted numeric answers (decimals supported).
- `multiple choice`: one correct option.
- `multiple response`: multiple correct options.

## How It Works

1. The creator builds a quiz object.
2. The object is serialized to JSON.
3. JSON is compressed with the browser-native `CompressionStream` API (`deflate`).
4. The compressed bytes are base64url encoded.
5. The encoded payload is placed in the URL hash.
6. The host view decodes and inflates the payload at runtime.

## Routing

- `#` (empty hash): Main landing view.
- `#create`: Quiz creator view.
- `#<compressed-payload>`: Hosted quiz view.

## Project Files

- `index.html`: app structure and views.
- `style.css`: visual theme and layout.
- `app.js`: routing, creator logic, encoding/decoding, quiz runtime.
- `SCHEMA`: data schema reference with comments.

## License

See `LICENSE`.

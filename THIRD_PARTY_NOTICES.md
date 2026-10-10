# Third-party notices

Leadora AI ships these open-source packages in its production build (`pnpm licenses list --prod`).
Each package's own license text and copyright notice ship with it inside the built images (`node_modules/<package>/`).

Regenerate with `node scripts/licenses.mjs`. The check fails on any license outside the allowed set (ADR-009).

## Summary

| License | Packages |
|---|---:|
| MIT | 219 |
| Apache-2.0 | 38 |
| ISC | 16 |
| BSD-2-Clause | 8 |
| BSD-3-Clause | 6 |
| Python-2.0 | 1 |
| CC-BY-4.0 | 1 |
| BSD | 1 |
| (MIT OR GPL-3.0-or-later) | 1 |
| MIT-0 | 1 |
| (MIT AND Zlib) | 1 |
| 0BSD | 1 |

## Reviewed exceptions

- `^@img\/sharp-(libvips-)?[a-z0-9-]+$`: Next.js image optimization. Prebuilt libvips (LGPL-3.0-or-later) is shipped as a separate, dynamically loaded library and is not modified.
- `jszip` is dual-licensed `(MIT OR GPL-3.0-or-later)`; it is used under MIT.
- `unzipper` is overridden to 0.12.3 (MIT): `exceljs` pins 0.10, which depends on `buffers`, a package with no license.

## Packages

| Package | Version | License | Homepage |
|---|---|---|---|
| @aws-sdk/checksums | 3.1001.1 | Apache-2.0 | https://github.com/aws/aws-sdk-js-v3/tree/main/packages-internal/checksums |
| @aws-sdk/client-s3 | 3.1147.0 | Apache-2.0 | https://github.com/aws/aws-sdk-js-v3/tree/main/clients/client-s3 |
| @aws-sdk/core | 3.978.1 | Apache-2.0 | https://github.com/aws/aws-sdk-js-v3/tree/main/packages-internal/core |
| @aws-sdk/credential-provider-env | 3.972.72 | Apache-2.0 | https://github.com/aws/aws-sdk-js-v3/tree/main/packages-internal/credential-provider-env |
| @aws-sdk/credential-provider-http | 3.972.74 | Apache-2.0 | https://github.com/aws/aws-sdk-js-v3/tree/main/packages-internal/credential-provider-http |
| @aws-sdk/credential-provider-ini | 3.973.17 | Apache-2.0 | https://github.com/aws/aws-sdk-js-v3/tree/main/packages-internal/credential-provider-ini |
| @aws-sdk/credential-provider-login | 3.972.79 | Apache-2.0 | https://github.com/aws/aws-sdk-js-v3/tree/main/packages-internal/credential-provider-login |
| @aws-sdk/credential-provider-node | 3.972.84 | Apache-2.0 | https://github.com/aws/aws-sdk-js-v3/tree/main/packages-internal/credential-provider-node |
| @aws-sdk/credential-provider-process | 3.972.72 | Apache-2.0 | https://github.com/aws/aws-sdk-js-v3/tree/main/packages-internal/credential-provider-process |
| @aws-sdk/credential-provider-sso | 3.973.16 | Apache-2.0 | https://github.com/aws/aws-sdk-js-v3/tree/main/packages-internal/credential-provider-sso |
| @aws-sdk/credential-provider-web-identity | 3.972.78 | Apache-2.0 | https://github.com/aws/aws-sdk-js-v3/tree/main/packages-internal/credential-provider-web-identity |
| @aws-sdk/middleware-sdk-s3 | 3.972.77 | Apache-2.0 | https://github.com/aws/aws-sdk-js-v3/tree/main/packages-internal/middleware-sdk-s3 |
| @aws-sdk/nested-clients | 3.997.46 | Apache-2.0 | https://github.com/aws/aws-sdk-js-v3/tree/main/packages/nested-clients |
| @aws-sdk/signature-v4-multi-region | 3.996.47 | Apache-2.0 | https://github.com/aws/aws-sdk-js-v3/tree/main/packages/signature-v4-multi-region |
| @aws-sdk/token-providers | 3.1138.0 | Apache-2.0 | https://github.com/aws/aws-sdk-js-v3/tree/main/packages/token-providers |
| @aws-sdk/types | 3.974.6 | Apache-2.0 | https://github.com/aws/aws-sdk-js-v3/tree/main/packages-internal/types |
| @aws-sdk/xml-builder | 3.972.41 | Apache-2.0 | https://github.com/aws/aws-sdk-js-v3/tree/main/packages-internal/xml-builder |
| @aws/lambda-invoke-store | 0.3.0 | Apache-2.0 | https://github.com/awslabs/aws-lambda-invoke-store |
| @borewit/text-codec | 0.2.2 | MIT | https://github.com/Borewit/text-codec#readme |
| @fast-csv/format | 4.3.5 | MIT | http://c2fo.github.com/fast-csv/packages/format |
| @fast-csv/parse | 4.3.6 | MIT | http://c2fo.github.com/fast-csv/packages/parse |
| @img/colour | 1.1.0 | MIT | https://github.com/lovell/colour#readme |
| @ioredis/commands | 2.0.0 | MIT | https://github.com/ioredis/commands |
| @lukeed/csprng | 1.1.0 | MIT | https://github.com/lukeed/csprng#readme |
| @microsoft/tsdoc | 0.17.0 | MIT | https://tsdoc.org/ |
| @msgpackr-extract/msgpackr-extract-win32-x64 | 3.0.4 | MIT | https://github.com/kriszyp/msgpackr-extract#readme |
| @nestjs/common | 12.1.2 | MIT | https://nestjs.com |
| @nestjs/core | 12.1.2 | MIT | https://nestjs.com |
| @nestjs/mapped-types | 12.0.0 | MIT | https://github.com/nestjs/mapped-types#readme |
| @nestjs/platform-express | 12.1.2 | MIT | https://nestjs.com |
| @nestjs/platform-ws | 12.1.2 | MIT | https://nestjs.com |
| @nestjs/swagger | 12.0.2 | MIT | https://github.com/nestjs/swagger#readme |
| @nestjs/websockets | 12.1.2 | MIT | https://github.com/nestjs/nest#readme |
| @next/env | 16.3.8 | MIT | https://github.com/vercel/next.js#readme |
| @next/swc-win32-x64-msvc | 16.3.8 | MIT | https://github.com/vercel/next.js#readme |
| @node-rs/argon2 | 2.2.2 | MIT | https://github.com/napi-rs/node-rs |
| @node-rs/argon2-win32-x64-msvc | 2.2.2 | MIT | https://github.com/napi-rs/node-rs |
| @pinojs/redact | 0.4.0 | MIT | https://github.com/pinojs/redact#readme |
| @scarf/scarf | 1.4.0 | Apache-2.0 | https://github.com/scarf-sh/scarf-js |
| @selderee/plugin-htmlparser2 | 0.12.0 | MIT | https://github.com/mxxii/selderee |
| @smithy/core | 3.35.1 | Apache-2.0 | https://github.com/smithy-lang/smithy-typescript/tree/main/packages/core |
| @smithy/credential-provider-imds | 4.5.2 | Apache-2.0 | https://github.com/smithy-lang/smithy-typescript/tree/main/packages/credential-provider-imds |
| @smithy/fetch-http-handler | 5.8.0 | Apache-2.0 | https://github.com/smithy-lang/smithy-typescript/tree/main/packages/fetch-http-handler |
| @smithy/node-http-handler | 4.12.1 | Apache-2.0 | https://github.com/smithy-lang/smithy-typescript/tree/main/packages/node-http-handler |
| @smithy/signature-v4 | 5.7.4 | Apache-2.0 | https://github.com/smithy-lang/smithy-typescript/tree/main/packages/signature-v4 |
| @smithy/types | 4.19.0 | Apache-2.0 | https://github.com/smithy-lang/smithy-typescript/tree/main/packages/types |
| @standard-schema/spec | 1.1.0 | MIT | https://standardschema.dev |
| @swc/helpers | 0.5.23 | Apache-2.0 | https://swc.rs |
| @tokenizer/inflate | 0.4.1 | MIT | https://github.com/Borewit/tokenizer-inflate#readme |
| @tokenizer/token | 0.3.0 | MIT | https://github.com/Borewit/tokenizer-token#readme |
| @types/node | 14.18.63, 26.6.4 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/node |
| @types/pg | 8.23.1 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/pg |
| @xmldom/xmldom | 0.8.15 | MIT | https://github.com/xmldom/xmldom |
| accepts | 2.0.0 | MIT | https://github.com/jshttp/accepts#readme |
| append-field | 1.0.0 | MIT | https://github.com/LinusU/node-append-field#readme |
| archiver | 5.3.2 | MIT | https://github.com/archiverjs/node-archiver |
| archiver-utils | 2.1.0, 3.0.4 | MIT | https://github.com/archiverjs/archiver-utils#readme |
| argparse | 1.0.10 | MIT | https://github.com/nodeca/argparse#readme |
| argparse | 2.0.1 | Python-2.0 | https://github.com/nodeca/argparse#readme |
| async | 3.2.6 | MIT | https://caolan.github.io/async/ |
| atomic-sleep | 1.0.0 | MIT | https://github.com/davidmarkclements/atomic-sleep#readme |
| balanced-match | 1.0.2 | MIT | https://github.com/juliangruber/balanced-match |
| base64-js | 1.5.1 | MIT | https://github.com/beatgammit/base64-js |
| baseline-browser-mapping | 2.11.27 | Apache-2.0 | https://github.com/web-platform-dx/baseline-browser-mapping#readme |
| bl | 4.1.0 | MIT | https://github.com/rvagg/bl |
| bluebird | 3.7.2 | MIT | https://github.com/petkaantonov/bluebird |
| body-parser | 2.3.0 | MIT | https://github.com/expressjs/body-parser#readme |
| bowser | 2.14.1 | MIT | https://github.com/bowser-js/bowser |
| brace-expansion | 1.1.21, 2.1.7 | MIT | https://github.com/juliangruber/brace-expansion |
| buffer | 5.7.1 | MIT | https://github.com/feross/buffer |
| buffer-crc32 | 0.2.13 | MIT | https://github.com/brianloveswords/buffer-crc32 |
| bullmq | 6.3.11 | MIT | https://bullmq.io/ |
| busboy | 1.6.0 | MIT | https://github.com/mscdex/busboy#readme |
| bytes | 3.1.2 | MIT | https://github.com/visionmedia/bytes.js#readme |
| call-bind-apply-helpers | 1.0.2 | MIT | https://github.com/ljharb/call-bind-apply-helpers#readme |
| call-bound | 1.0.4 | MIT | https://github.com/ljharb/call-bound#readme |
| caniuse-lite | 1.0.30001814 | CC-BY-4.0 | https://github.com/browserslist/caniuse-lite#readme |
| client-only | 0.0.1 | MIT | https://reactjs.org/ |
| cluster-key-slot | 1.1.1 | Apache-2.0 | https://github.com/Salakar/cluster-key-slot#readme |
| compress-commons | 4.1.2 | MIT | https://github.com/archiverjs/node-compress-commons |
| concat-map | 0.0.1 | MIT | https://github.com/substack/node-concat-map#readme |
| content-disposition | 1.1.0 | MIT | https://github.com/jshttp/content-disposition#readme |
| content-type | 1.0.5, 2.1.0 | MIT | https://github.com/jshttp/content-type#readme |
| cookie | 0.7.2, 2.0.1 | MIT | https://github.com/jshttp/cookie#readme |
| cookie-parser | 1.4.7 | MIT | https://github.com/expressjs/cookie-parser#readme |
| cookie-signature | 1.0.6, 1.2.2 | MIT | https://github.com/visionmedia/node-cookie-signature#readme |
| core-util-is | 1.0.3 | MIT | https://github.com/isaacs/core-util-is#readme |
| cors | 2.8.6 | MIT | https://github.com/expressjs/cors#readme |
| crc-32 | 1.2.2 | Apache-2.0 | https://sheetjs.com/ |
| crc32-stream | 4.0.3 | MIT | https://github.com/archiverjs/node-crc32-stream |
| cron-parser | 5.10.1 | MIT | https://github.com/harrisiirak/cron-parser#readme |
| csv-parse | 7.0.3 | MIT | https://csv.js.org/parse |
| dayjs | 1.11.23 | MIT | https://day.js.org |
| debug | 4.4.3 | MIT | https://github.com/debug-js/debug#readme |
| deepmerge-ts | 8.0.2 | BSD-3-Clause | https://github.com/RebeccaStevens/deepmerge-ts#readme |
| denque | 2.1.0 | Apache-2.0 | https://docs.page/invertase/denque |
| depd | 2.0.0 | MIT | https://github.com/dougwilson/nodejs-depd#readme |
| detect-libc | 2.1.2 | Apache-2.0 | https://github.com/lovell/detect-libc#readme |
| dingbat-to-unicode | 1.0.2 | BSD-2-Clause | https://github.com/mwilliamson/dingbat-to-unicode#readme |
| dom-serializer | 2.0.0 | MIT | https://github.com/cheeriojs/dom-serializer#readme |
| domelementtype | 2.3.0 | BSD-2-Clause | https://github.com/fb55/domelementtype#readme |
| domhandler | 5.0.3 | BSD-2-Clause | https://github.com/fb55/domhandler#readme |
| domutils | 3.2.2 | BSD-2-Clause | https://github.com/fb55/domutils#readme |
| drizzle-orm | 0.45.3 | Apache-2.0 | https://orm.drizzle.team |
| duck | 0.1.12 | BSD | https://github.com/mwilliamson/duck.js#readme |
| dunder-proto | 1.0.1 | MIT | https://github.com/es-shims/dunder-proto#readme |
| duplexer2 | 0.1.4 | BSD-3-Clause | https://github.com/deoxxa/duplexer2#readme |
| ee-first | 1.1.1 | MIT | https://github.com/jonathanong/ee-first#readme |
| encodeurl | 2.0.0 | MIT | https://github.com/pillarjs/encodeurl#readme |
| end-of-stream | 1.4.5 | MIT | https://github.com/mafintosh/end-of-stream |
| entities | 4.5.0, 7.0.1 | BSD-2-Clause | https://github.com/fb55/entities#readme |
| es-define-property | 1.0.1 | MIT | https://github.com/ljharb/es-define-property#readme |
| es-errors | 1.3.0 | MIT | https://github.com/ljharb/es-errors#readme |
| es-object-atoms | 1.1.2 | MIT | https://github.com/ljharb/es-object-atoms#readme |
| es-toolkit | 1.52.0 | MIT | https://es-toolkit.dev |
| escape-html | 1.0.3 | MIT | https://github.com/component/escape-html#readme |
| etag | 1.8.1 | MIT | https://github.com/jshttp/etag#readme |
| exceljs | 4.4.0 | MIT | https://github.com/exceljs/exceljs#readme |
| express | 5.2.1 | MIT | https://expressjs.com/ |
| fast-csv | 4.3.6 | MIT | http://c2fo.github.com/fast-csv |
| fast-safe-stringify | 2.1.1 | MIT | https://github.com/davidmarkclements/fast-safe-stringify#readme |
| file-type | 22.1.1 | MIT | https://github.com/sindresorhus/file-type#readme |
| finalhandler | 2.1.1 | MIT | https://github.com/pillarjs/finalhandler#readme |
| forwarded | 0.2.0 | MIT | https://github.com/jshttp/forwarded#readme |
| fresh | 2.0.0 | MIT | https://github.com/jshttp/fresh#readme |
| fs-constants | 1.0.0 | MIT | https://github.com/mafintosh/fs-constants |
| fs-extra | 11.4.1 | MIT | https://github.com/jprichardson/node-fs-extra |
| fs.realpath | 1.0.0 | ISC | https://github.com/isaacs/fs.realpath#readme |
| function-bind | 1.1.2 | MIT | https://github.com/Raynos/function-bind |
| get-caller-file | 2.0.5 | ISC | https://github.com/stefanpenner/get-caller-file#readme |
| get-intrinsic | 1.3.0 | MIT | https://github.com/ljharb/get-intrinsic#readme |
| get-proto | 1.0.1 | MIT | https://github.com/ljharb/get-proto#readme |
| glob | 7.2.3 | ISC | https://github.com/isaacs/node-glob#readme |
| gopd | 1.2.0 | MIT | https://github.com/ljharb/gopd#readme |
| graceful-fs | 4.2.11 | ISC | https://github.com/isaacs/node-graceful-fs#readme |
| has-symbols | 1.1.0 | MIT | https://github.com/ljharb/has-symbols#readme |
| hasown | 2.0.4 | MIT | https://github.com/inspect-js/hasOwn#readme |
| html-to-text | 10.0.1 | MIT | https://github.com/html-to-text/node-html-to-text |
| htmlparser2 | 10.1.0 | MIT | https://github.com/fb55/htmlparser2#readme |
| http-errors | 2.0.1 | MIT | https://github.com/jshttp/http-errors#readme |
| iconv-lite | 0.7.3 | MIT | https://github.com/pillarjs/iconv-lite |
| ieee754 | 1.2.1 | BSD-3-Clause | https://github.com/feross/ieee754#readme |
| immediate | 3.0.6 | MIT | https://github.com/calvinmetcalf/immediate#readme |
| inflight | 1.0.6 | ISC | https://github.com/isaacs/inflight |
| inherits | 2.0.4 | ISC | https://github.com/isaacs/inherits#readme |
| ioredis | 6.0.0 | MIT | https://github.com/redis/ioredis#readme |
| ipaddr.js | 1.9.1 | MIT | https://github.com/whitequark/ipaddr.js#readme |
| is-promise | 4.0.0 | MIT | https://github.com/then/is-promise#readme |
| isarray | 1.0.0 | MIT | https://github.com/juliangruber/isarray |
| iterare | 1.2.1 | ISC | https://github.com/felixfbecker/iterare#readme |
| js-yaml | 5.4.2 | MIT | https://github.com/nodeca/js-yaml#readme |
| jsonfile | 6.2.1 | MIT | https://github.com/jprichardson/node-jsonfile#readme |
| jszip | 3.10.2 | (MIT OR GPL-3.0-or-later) | https://github.com/Stuk/jszip#readme |
| lazystream | 1.0.1 | MIT | https://github.com/jpommerening/node-lazystream |
| leac | 0.7.0 | MIT | https://github.com/mxxii/leac |
| libphonenumber-js | 1.13.14 | MIT | https://gitlab.com/catamphetamine/libphonenumber-js#readme |
| lie | 3.3.0 | MIT | https://github.com/calvinmetcalf/lie#readme |
| load-esm | 1.0.3 | MIT | https://github.com/Borewit/load-esm#readme |
| lodash.defaults | 4.2.0 | MIT | https://lodash.com/ |
| lodash.difference | 4.5.0 | MIT | https://lodash.com/ |
| lodash.escaperegexp | 4.1.2 | MIT | https://lodash.com/ |
| lodash.flatten | 4.4.0 | MIT | https://lodash.com/ |
| lodash.groupby | 4.6.0 | MIT | https://lodash.com/ |
| lodash.isboolean | 3.0.3 | MIT | https://lodash.com/ |
| lodash.isequal | 4.5.0 | MIT | https://lodash.com/ |
| lodash.isfunction | 3.0.9 | MIT | https://lodash.com/ |
| lodash.isnil | 4.0.0 | MIT | https://lodash.com/ |
| lodash.isplainobject | 4.0.6 | MIT | https://lodash.com/ |
| lodash.isundefined | 3.0.1 | MIT | https://lodash.com/ |
| lodash.union | 4.6.0 | MIT | https://lodash.com/ |
| lodash.uniq | 4.5.0 | MIT | https://lodash.com/ |
| lop | 0.4.2 | BSD-2-Clause | https://github.com/mwilliamson/lop#readme |
| luxon | 3.7.2 | MIT | https://github.com/moment/luxon#readme |
| mammoth | 1.13.0 | BSD-2-Clause | https://github.com/mwilliamson/mammoth.js#readme |
| math-intrinsics | 1.1.0 | MIT | https://github.com/es-shims/math-intrinsics#readme |
| media-typer | 0.3.0, 1.1.1 | MIT | https://github.com/jshttp/media-typer#readme |
| merge-descriptors | 2.0.0 | MIT | https://github.com/sindresorhus/merge-descriptors#readme |
| mime-db | 1.52.0, 1.54.0 | MIT | https://github.com/jshttp/mime-db#readme |
| mime-types | 2.1.35, 3.0.2 | MIT | https://github.com/jshttp/mime-types#readme |
| minimatch | 3.1.5, 5.1.9 | ISC | https://github.com/isaacs/minimatch#readme |
| ms | 2.1.3 | MIT | https://github.com/vercel/ms#readme |
| msgpackr | 2.1.0 | MIT | https://github.com/kriszyp/msgpackr#readme |
| msgpackr-extract | 3.0.4 | MIT | https://github.com/kriszyp/msgpackr-extract#readme |
| multer | 2.4.0 | MIT | https://github.com/expressjs/multer#readme |
| nanoid | 3.3.20 | MIT | https://github.com/ai/nanoid#readme |
| negotiator | 1.1.0 | MIT | https://github.com/jshttp/negotiator#readme |
| nestjs-pino | 5.3.1 | MIT | https://github.com/iamolegga/nestjs-pino#readme |
| next | 16.3.8 | MIT | https://nextjs.org |
| node-abort-controller | 3.1.1 | MIT | https://github.com/southpolesteve/node-abort-controller#readme |
| node-gyp-build-optional-packages | 5.2.2 | MIT | https://github.com/prebuild/node-gyp-build |
| node-int64 | 0.4.0 | MIT | https://github.com/broofa/node-int64#readme |
| nodemailer | 10.0.15 | MIT-0 | https://nodemailer.com/ |
| normalize-path | 3.0.0 | MIT | https://github.com/jonschlinkert/normalize-path |
| object-assign | 4.1.1 | MIT | https://github.com/sindresorhus/object-assign#readme |
| object-hash | 3.0.0 | MIT | https://github.com/puleos/object-hash |
| object-inspect | 1.13.4 | MIT | https://github.com/inspect-js/object-inspect |
| on-exit-leak-free | 2.1.2 | MIT | https://github.com/mcollina/on-exit-or-gc#readme |
| on-finished | 2.4.1 | MIT | https://github.com/jshttp/on-finished#readme |
| once | 1.4.0 | ISC | https://github.com/isaacs/once#readme |
| option | 0.2.4 | BSD-2-Clause | https://github.com/mwilliamson/node-options#readme |
| pako | 1.0.11 | (MIT AND Zlib) | https://github.com/nodeca/pako |
| parseley | 0.13.1 | MIT | https://github.com/mxxii/parseley |
| parseurl | 1.3.3 | MIT | https://github.com/pillarjs/parseurl#readme |
| path-is-absolute | 1.0.1 | MIT | https://github.com/sindresorhus/path-is-absolute#readme |
| path-to-regexp | 8.4.2 | MIT | https://github.com/pillarjs/path-to-regexp#readme |
| peberminta | 0.10.0 | MIT | https://github.com/mxxii/peberminta |
| pg | 8.23.1 | MIT | https://github.com/brianc/node-postgres |
| pg-cloudflare | 1.4.1 | MIT | https://github.com/brianc/node-postgres#readme |
| pg-connection-string | 2.14.1 | MIT | https://github.com/brianc/node-postgres/tree/master/packages/pg-connection-string |
| pg-int8 | 1.0.1 | ISC | https://github.com/charmander/pg-int8#readme |
| pg-pool | 3.14.0 | MIT | https://github.com/brianc/node-postgres/tree/master/packages/pg-pool#readme |
| pg-protocol | 1.16.1 | MIT | https://github.com/brianc/node-postgres#readme |
| pg-types | 2.2.0 | MIT | https://github.com/brianc/node-pg-types |
| pgpass | 1.0.5 | MIT | https://github.com/hoegaarden/pgpass#readme |
| picocolors | 1.1.1 | ISC | https://github.com/alexeyraspopov/picocolors#readme |
| pino | 10.4.0 | MIT | https://getpino.io |
| pino-abstract-transport | 3.0.0 | MIT | https://github.com/pinojs/pino-abstract-transport#readme |
| pino-http | 11.0.0 | MIT | https://github.com/pinojs/pino-http#readme |
| pino-std-serializers | 7.1.0 | MIT | https://github.com/pinojs/pino-std-serializers#readme |
| postcss | 8.5.23 | MIT | https://postcss.org/ |
| postgres-array | 2.0.0 | MIT | https://github.com/bendrucker/postgres-array#readme |
| postgres-bytea | 1.0.1 | MIT | https://github.com/bendrucker/postgres-bytea#readme |
| postgres-date | 1.0.7 | MIT | https://github.com/bendrucker/postgres-date#readme |
| postgres-interval | 1.2.0 | MIT | https://github.com/bendrucker/postgres-interval#readme |
| process-nextick-args | 2.0.1 | MIT | https://github.com/calvinmetcalf/process-nextick-args |
| process-warning | 5.1.0 | MIT | https://github.com/fastify/fastify-warning#readme |
| proxy-addr | 2.0.8 | MIT | https://github.com/jshttp/proxy-addr#readme |
| qs | 6.16.0 | BSD-3-Clause | https://github.com/ljharb/qs |
| quick-format-unescaped | 4.0.4 | MIT | https://github.com/davidmarkclements/quick-format#readme |
| range-parser | 1.3.0 | MIT | https://github.com/jshttp/range-parser#readme |
| raw-body | 3.0.2 | MIT | https://github.com/stream-utils/raw-body#readme |
| react | 19.3.0 | MIT | https://react.dev/ |
| react-dom | 19.3.0 | MIT | https://react.dev/ |
| readable-stream | 2.3.8, 3.6.2 | MIT | https://github.com/nodejs/readable-stream#readme |
| readdir-glob | 1.1.3 | Apache-2.0 | https://github.com/Yqnn/node-readdir-glob |
| real-require | 1.0.0 | MIT | https://github.com/pinojs/real-require |
| redis-errors | 1.2.0 | MIT | https://github.com/NodeRedis/redis-errors#readme |
| reflect-metadata | 0.2.2 | Apache-2.0 | http://rbuckton.github.io/reflect-metadata |
| router | 2.2.0 | MIT | https://github.com/pillarjs/router#readme |
| rxjs | 7.8.2 | Apache-2.0 | https://rxjs.dev |
| safe-buffer | 5.1.2 | MIT | https://github.com/feross/safe-buffer |
| safe-stable-stringify | 2.5.0 | MIT | https://github.com/BridgeAR/safe-stable-stringify#readme |
| safer-buffer | 2.1.2 | MIT | https://github.com/ChALkeR/safer-buffer#readme |
| saxes | 5.0.1 | ISC | https://github.com/lddubeau/saxes#readme |
| scheduler | 0.28.0 | MIT | https://react.dev/ |
| selderee | 0.12.0 | MIT | https://github.com/mxxii/selderee |
| semver | 7.8.5 | ISC | https://github.com/npm/node-semver#readme |
| send | 1.2.1 | MIT | https://github.com/pillarjs/send#readme |
| serve-static | 2.2.1 | MIT | https://github.com/expressjs/serve-static#readme |
| server-only | 0.0.1 | MIT | https://reactjs.org/ |
| setimmediate | 1.0.5 | MIT | https://github.com/YuzuJS/setImmediate#readme |
| setprototypeof | 1.2.0 | ISC | https://github.com/wesleytodd/setprototypeof |
| sharp | 0.35.5 | Apache-2.0 | https://sharp.pixelplumbing.com |
| side-channel | 1.1.1 | MIT | https://github.com/ljharb/side-channel#readme |
| side-channel-list | 1.0.1 | MIT | https://github.com/ljharb/side-channel-list#readme |
| side-channel-map | 1.0.1 | MIT | https://github.com/ljharb/side-channel-map#readme |
| side-channel-weakmap | 1.0.2 | MIT | https://github.com/ljharb/side-channel-weakmap#readme |
| sonic-boom | 4.2.1 | MIT | https://github.com/pinojs/sonic-boom#readme |
| source-map-js | 1.2.2 | BSD-3-Clause | https://github.com/7rulnik/source-map-js |
| split2 | 4.2.0 | ISC | https://github.com/mcollina/split2#readme |
| sprintf-js | 1.0.3 | BSD-3-Clause | https://github.com/alexei/sprintf.js#readme |
| standard-as-callback | 2.1.0 | MIT | https://github.com/luin/asCallback#readme |
| statuses | 2.0.2 | MIT | https://github.com/jshttp/statuses#readme |
| streamsearch | 1.1.0 | MIT | https://github.com/mscdex/streamsearch#readme |
| string_decoder | 1.1.1 | MIT | https://github.com/nodejs/string_decoder |
| strtok3 | 10.3.5 | MIT | https://github.com/Borewit/strtok3#readme |
| styled-jsx | 5.1.6 | MIT | https://github.com/vercel/styled-jsx#readme |
| swagger-ui-dist | 5.33.0 | Apache-2.0 | https://github.com/swagger-api/swagger-ui#readme |
| tar-stream | 2.2.0 | MIT | https://github.com/mafintosh/tar-stream |
| thread-stream | 4.2.0 | MIT | https://github.com/mcollina/thread-stream#readme |
| tmp | 0.2.7 | MIT | http://github.com/raszi/node-tmp |
| toidentifier | 1.0.1 | MIT | https://github.com/component/toidentifier#readme |
| token-types | 6.1.2 | MIT | https://github.com/Borewit/token-types#readme |
| tslib | 2.8.1 | 0BSD | https://www.typescriptlang.org/ |
| type-is | 1.6.18, 2.1.0 | MIT | https://github.com/jshttp/type-is#readme |
| typescript | 6.0.3 | Apache-2.0 | https://www.typescriptlang.org/ |
| uid | 2.0.2 | MIT | https://github.com/lukeed/uid#readme |
| uint8array-extras | 1.6.0 | MIT | https://github.com/sindresorhus/uint8array-extras#readme |
| underscore | 1.13.8 | MIT | https://underscorejs.org |
| undici-types | 8.9.0 | MIT | https://undici.nodejs.org |
| universalify | 2.0.1 | MIT | https://github.com/RyanZim/universalify#readme |
| unpdf | 1.8.1 | MIT | https://github.com/unjs/unpdf#readme |
| unpipe | 1.0.0 | MIT | https://github.com/stream-utils/unpipe#readme |
| unzipper | 0.12.3 | MIT | https://github.com/ZJONSSON/node-unzipper#readme |
| util-deprecate | 1.0.2 | MIT | https://github.com/TooTallNate/util-deprecate |
| uuid | 8.3.2 | MIT | https://github.com/uuidjs/uuid#readme |
| vary | 1.1.2 | MIT | https://github.com/jshttp/vary#readme |
| wrappy | 1.0.2 | ISC | https://github.com/npm/wrappy |
| ws | 8.22.0 | MIT | https://github.com/websockets/ws |
| xmlbuilder | 10.1.1 | MIT | http://github.com/oozcitak/xmlbuilder-js |
| xmlchars | 2.2.0 | MIT | https://github.com/lddubeau/xmlchars#readme |
| xtend | 4.0.2 | MIT | https://github.com/Raynos/xtend |
| zip-stream | 4.1.1 | MIT | https://github.com/archiverjs/node-zip-stream |
| zod | 4.6.5 | MIT | https://zod.dev |

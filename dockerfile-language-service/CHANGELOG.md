# Changelog
All notable changes to this project will be documented in this file.

## [0.0.9] - 2020-02-12
### Added
- support completing of tags for published images on the Docker Store ([#50](https://github.com/rcjsuen/dockerfile-language-service/issues/50))
- support completion of the `--platform` flag for FROMs introduced in Docker CE 18.04 ([#52](https://github.com/rcjsuen/dockerfile-language-service/issues/52))
- support hover documentation for the `--platform` flag for FROMs introduced in Docker CE 18.04 ([#53](https://github.com/rcjsuen/dockerfile-language-service/issues/53))
- add validation of FROM's `--platform` flag introduced in Docker CE 18.04 ([rcjsuen/dockerfile-utils#68](https://github.com/rcjsuen/dockerfile-utils/issues/68))
  - `ValidationCode.UNKNOWN_FROM_FLAG`
- warn if two escape parser directives are defined ([rcjsuen/dockerfile-utils#70](https://github.com/rcjsuen/dockerfile-utils/issues/70))
- experimental work-in-progress support for retrieving the semantic tokens of a Dockerfile to support semantic highlighting ([#54](https://github.com/rcjsuen/dockerfile-language-service/issues/54))
  - as the language server protocol design for this is not complete, this API is in flux and is subject to change or even outright removal
  - please use this API with caution

### Fixed
- allow paths to be quoted in WORKDIRs ([rcjsuen/dockerfile-utils#67](https://github.com/rcjsuen/dockerfile-utils/issues/67))
- do not calculate edits for lines that are already formatted correctly ([rcjsuen/dockerfile-utils#66](https://github.com/rcjsuen/dockerfile-utils/issues/66))
- allow an instruction with an argument on the last line to be parsed if it has no leading whitespace and has a length of one ([rcjsuen/dockerfile-utils#69](https://github.com/rcjsuen/dockerfile-utils/issues/69))

## [0.0.8] - 2018-05-23
### Added
- allow Bash syntax for variable modifiers in RUNs ([rcjsuen/dockerfile-utils#56](https://github.com/rcjsuen/dockerfile-utils/issues/56))
- warn if FROM has a variable for an image and it references nothing ([rcjsuen/dockerfile-utils#59](https://github.com/rcjsuen/dockerfile-utils/issues/59))

### Changed
- upgraded the dependency of `lodash` from 4.17.5 to 4.17.11 to prevent ourselves from being exposd to [CVE-2018-16487](https://nvd.nist.gov/vuln/detail/CVE-2018-16487)
  - as `lodash` was only being used in the example, there is no reason to believe that consumers of the `dockerfile-language-service` module itself was affected by this vulnerability
  - nonetheless, anyone that was using the example as a reference is encouraged to update themselves as well

### Fixed
- corrected a small typo for VOLUME ([#47](https://github.com/rcjsuen/dockerfile-language-service/issues/47))
- allow quoted ARG variables in EXPOSE ([rcjsuen/dockerfile-utils#58](https://github.com/rcjsuen/dockerfile-utils/issues/58))
- allow ENV variables that reference ARG variables in EXPOSE ([rcjsuen/dockerfile-utils#57](https://github.com/rcjsuen/dockerfile-utils/issues/57))
- do not validate variable substitutions if found in RUN ([rcjsuen/dockerfile-utils#60](https://github.com/rcjsuen/dockerfile-utils/issues/60))
- only allow alphanumeric characters and underscores in variable names ([#49](https://github.com/rcjsuen/dockerfile-language-service/issues/49))

## [0.0.7] - 2018-12-29
### Added
- add support to test the validity of a rename at a given position ([#40](https://github.com/rcjsuen/dockerfile-language-service/issues/40))
- support folding of instructions that span multiple lines ([#43](https://github.com/rcjsuen/dockerfile-language-service/issues/43))


### Changed
- upgraded example's dependencies to include fix to atob for [CVE-2018-3745](https://nvd.nist.gov/vuln/detail/CVE-2018-3745)
  - anyone that was known to have used the example as a reference should ensure that they upgrade their dependency to atob

### Fixed
- ignore variables when validating directories for ARGs and COPYs ([rcjsuen/dockerfile-utils#54](https://github.com/rcjsuen/dockerfile-utils/issues/54))
- allow build stages to be case insensitive when looking up its definition ([#41](https://github.com/rcjsuen/dockerfile-language-service/issues/41))
- allow build stages to be case insensitive when highlighting them ([#41](https://github.com/rcjsuen/dockerfile-language-service/issues/41))
- allow build stages to be case insensitive when renaming them ([#41](https://github.com/rcjsuen/dockerfile-language-service/issues/41))
- consider all build stages with the same name in FROMs when highlighting or renaming ([#42](https://github.com/rcjsuen/dockerfile-language-service/issues/42))

## [0.0.6] - 2018-08-19
### Added
- updated Capabilities interface to support customizing how folding ranges should be processed and returned ([#33](https://github.com/rcjsuen/dockerfile-language-service/issues/33))
```TypeScript
export interface Capabilities {
    /**
     * Capabilities related to folding range requests.
     */
    foldingRange?: {
        /**
         * If set, the service may choose to return ranges that have
         * a bogus `startCharacter` and/or `endCharacter` and/or to
         * leave them as undefined.
         */
        lineFoldingOnly?: boolean;
        /**
         * The maximum number of folding ranges to return. This is a
         * hint and the service may choose to ignore this limit.
         */
        rangeLimit?: number;
    };
}
```
- add support for computing folding ranges of a Dockerfile ([#33](https://github.com/rcjsuen/dockerfile-language-service/issues/33))
- optionally flag WORKDIR instructions that do not point to an absolute path ([rcjsuen/dockerfile-utils#47](https://github.com/rcjsuen/dockerfile-utils/issues/47))
- add support for SCTP in EXPOSE instruction ([rcjsuen/dockerfile-utils#52](https://github.com/rcjsuen/dockerfile-utils/issues/52))

### Fixed
- fix incorrect validation of ENV and LABEL instructions with many quoted properties on mulitple lines ([rcjsuen/dockerfile-utils#50](https://github.com/rcjsuen/dockerfile-utils/issues/50))

## [0.0.5] - 2018-06-29
### Added
- updated Capabilities interface to support the deprecated property on CompletionItems ([#35](https://github.com/rcjsuen/dockerfile-language-service/issues/35))
```TypeScript
interface Capabilities {
    /**
     * Capabilities related to completion requests.
     */
    completion?: {
        /**
         * Capabilities related to completion items.
         */
        completionItem?: {
            /**
             * Indicates whether completion items for deprecated
             * entries should be explicitly flagged in the item.
             */
            deprecatedSupport?: boolean;
        }
    }
}
```
- add support for indicating that the MAINTAINER instruction is deprecated when returning it as a completion item ([#35](https://github.com/rcjsuen/dockerfile-language-service/issues/35))
- add support for indicating that the MAINTAINER instruction is deprecated when returning the document's list of symbols ([#36](https://github.com/rcjsuen/dockerfile-language-service/issues/36))
- add support for populating targets in document links in a resolution step ([#38](https://github.com/rcjsuen/dockerfile-language-service/issues/38))
- flag FROM instructions that refer to an invalid image digest in a private registry with a port as an error ([rcjsuen/dockerfile-utils#42](https://github.com/rcjsuen/dockerfile-utils/issues/42))
- flag variables that have an invalid modifier set ([rcjsuen/dockerfile-utils#38](https://github.com/rcjsuen/dockerfile-utils/issues/38))
- warn if ARG instruction does not define a name for the variable ([rcjsuen/dockerfile-utils#45](https://github.com/rcjsuen/dockerfile-utils/issues/45))
- flag incorrectly quoted arguments for ARG, ENV, and LABEL ([rcjsuen/dockerfile-utils#40](https://github.com/rcjsuen/dockerfile-utils/issues/40))

### Changed
- [upgraded the dependency of Mocha](https://github.com/mochajs/mocha/issues/2791) from 3.x to 5.x
  - versions prior to 4.x of Mocha dependended on Growl 1.9.2 which contained a [security vulnerability](https://github.com/tj/node-growl/issues/60)
  - as Mocha is a `devDependencies` module, there is no reason to believe that consumers of the `dockerfile-language-service` module itself was affected by this vulnerability

### Fixed
- image tag completion inserts extra text if word boundary is ambiguous ([#39](https://github.com/rcjsuen/dockerfile-language-service/issues/39)) 
- resolve variables to uninitialized ARGs with ARGs at the top of the Dockerfile if they exist ([#34](https://github.com/rcjsuen/dockerfile-language-service/issues/34))
- fix incorrect validation warning in ARG, ENV, and LABEL instructions caused by quotes being used in variable replacements ([rcjsuen/dockerfile-utils#36](https://github.com/rcjsuen/dockerfile-utils/issues/36))
- fix incorrect validation of tagged images caused by FROM referencing images in a private registry ([rcjsuen/dockerfile-utils#39](https://github.com/rcjsuen/dockerfile-utils/issues/39))
- allow variables to be used in a FROM's base image argument ([rcjsuen/dockerfile-utils#43](https://github.com/rcjsuen/dockerfile-utils/issues/43))
- handle ARG instructions with escaped newlines that lead to an EOF comment ([rcjsuen/dockerfile-utils#44](https://github.com/rcjsuen/dockerfile-utils/issues/44))

## [0.0.4] - 2018-04-16
### Fixed
- do not flag FROM instructions that use variables with an error ([rcjsuen/dockerfile-utils#35](https://github.com/rcjsuen/dockerfile-utils/issues/35))

## [0.0.3] - 2018-04-14
### Added
- updated Capabilities interface to support documentation formats for CompletionItems ([#12](https://github.com/rcjsuen/dockerfile-language-service/issues/12))
```TypeScript
interface Capabilities {
    /**
     * Capabilities related to completion requests.
     */
    completion?: {
        /**
         * Capabilities related to completion items.
         */
        completionItem?: {
            /**
             * Describes the supported content types that can be used
             * for a CompletionItem's documentation field.
             */
            documentationFormat?: MarkupKind[];
        }
    }
}
```
- allow documentation in CompletionItems to be provided in Markdown ([#12](https://github.com/rcjsuen/dockerfile-language-service/issues/12))
- warn if hyphens are being parsed as a unit of time in HEALTHCHECK duration flags ([rcjsuen/dockerfile-utils#24](https://github.com/rcjsuen/dockerfile-utils/issues/24))
- warn if two or more decimals found in a unit of time in HEALTHCHECK duration flags ([rcjsuen/dockerfile-utils#25](https://github.com/rcjsuen/dockerfile-utils/issues/25))
- warn if two hyphens are found in HEALTHCHECK duration flags ([rcjsuen/dockerfile-utils#26](https://github.com/rcjsuen/dockerfile-utils/issues/26))
- warn if instruction is written in JSON form incorrectly with single quotes ([rcjsuen/dockerfile-utils#28](https://github.com/rcjsuen/dockerfile-utils/issues/28))

### Fixed
- fix incorrect validation error if a COPY uses JSON arguments and its last string argument is correctly defined as a folder ([rcjsuen/dockerfile-utils#29](https://github.com/rcjsuen/dockerfile-utils/issues/29))
- fix incorrect validation error if an ADD uses JSON arguments and its last string argument is correctly defined as a folder ([rcjsuen/dockerfile-utils#30](https://github.com/rcjsuen/dockerfile-utils/issues/30))
- skip validation of content after a JSON's closing bracket ([rcjsuen/dockerfile-utils#33](https://github.com/rcjsuen/dockerfile-utils/issues/33))
- fix validation of number of arguments for ADD and COPY instructions written in JSON ([rcjsuen/dockerfile-utils#34](https://github.com/rcjsuen/dockerfile-utils/issues/34))

## [0.0.2] - 2018-03-08
### Added
- new Capabilities interface for defining what features the language service should support and enable
```TypeScript
interface Capabilities {
    /**
     * Capabilities related to completion requests.
     */
    completion?: {
        /**
         * Capabilities related to completion items.
         */
        completionItem?: {
            /**
             * Indicates whether the snippet syntax should be used in
             * returned completion items.
             */
            snippetSupport?: boolean;
        }
    };
    /**
     * Capabilities related to hover requests.
     */
    hover?: {
        /**
         * Describes the content type that should be returned for hovers.
         */
        contentFormat?: MarkupKind[];
    }
}
```
- new computeCommandEdits function to DockerfileLanguageService ([#4](https://github.com/rcjsuen/dockerfile-language-service/issues/4))
- update documentation to state that ARG was introduced in Docker 1.9 ([#7](https://github.com/rcjsuen/dockerfile-language-service/issues/7))
- allow hover information to be returned in Markdown or plain text ([#14](https://github.com/rcjsuen/dockerfile-language-service/issues/14))

### Changed
- change the signature of DockerfileLanguageService's computeHighlightRanges function by removing its first URI string parameter ([#15](https://github.com/rcjsuen/dockerfile-language-service/issues/15))
```TypeScript
import { Position } from 'vscode-languageserver-types';
// removed
let ranges = service.computeHighlightRanges(uri, content, Position.create(3, 1));
// replace the above with the following
let ranges = service.computeHighlightRanges(content, Position.create(3, 1));
```
- change the signature of DockerfileLanguageService's computeCompletionItems function by removing its final boolean parameter ([#23](https://github.com/rcjsuen/dockerfile-language-service/issues/23))
```TypeScript
import { Position } from 'vscode-languageserver-types';
// removed
let ranges = service.computeCompletionItems(content, Position.create(3, 1), true);
// replace the above with the following
service.setCapabilities({ completion: { completionItem: { snippetSupport: true } } });
let ranges = service.computeCompletionItems(content, Position.create(3, 1));
```

### Fixed
- change documentation to state that STOPSIGNAL was added in Docker 1.9 instead of Docker 1.12 ([#6](https://github.com/rcjsuen/dockerfile-language-service/issues/6))
- align active parameter amongst all displayed signatures for a FROM with a build stage name ([#8](https://github.com/rcjsuen/dockerfile-language-service/issues/8))
- fix validate function to read the provided settings ([#18](https://github.com/rcjsuen/dockerfile-language-service/issues/18))
- use a non-zero range for the diagnostic if FROM's base image's digest is the empty string ([rcjsuen/dockerfile-utils#21](https://github.com/rcjsuen/dockerfile-utils/issues/21))
- ignore multiple CMD, ENTRYPOINT, and HEALTHCHECK instructions in a Dockerfile if there is only ever one in a build stage ([rcjsuen/dockerfile-utils#22](https://github.com/rcjsuen/dockerfile-utils/issues/22))
- handle invalid decimal values without a leading zero for duration flags ([rcjsuen/dockerfile-utils#23](https://github.com/rcjsuen/dockerfile-utils/issues/23))
- ignore and return null for hover computations with an invalid position ([#22](https://github.com/rcjsuen/dockerfile-language-service/issues/22))

### Removed
- replaced DockerfileLanguageService's createWorkspaceEdit with a computeCommandEdits function ([#4](https://github.com/rcjsuen/dockerfile-language-service/issues/4))
```TypeScript
// removed
let workspaceEdit = service.createWorkspaceEdit(dockerfileContent, commandId, args);
// replace the above with the following
let uri = ...; // the URI of the opened Dockerfile
let edits = service.computeCommandEdits(dockerfileContent, commandId, args);
let workspaceEdit = {
  changes: {
    [ uri ]: edits
  }
}
```

## 0.0.1 - 2018-02-17
### Added
- created a language service that exposes an API similar to that defined by the language server protocol
  - validation and proposed resolution of said errors and warnings
    - textDocument/publishDiagnostics
    - textDocument/codeAction
    - workspace/executeCommand
  - navigation and editing
    - textDocument/definition
    - textDocument/documentHighlight
    - textDocument/documentSymbol
    - textDocument/documentLink
  - code completion
    - completionItem/resolve
    - textDocument/completion
    - textDocument/signatureHelp
  - formatting
    - textDocument/formatting
    - textDocument/onTypeFormatting
    - textDocument/rangeFormatting
  - contextual information
    - textDocument/rename
    - textDocument/hover

[0.0.9]: https://github.com/rcjsuen/dockerfile-language-service/compare/v0.0.8...v0.0.9
[0.0.8]: https://github.com/rcjsuen/dockerfile-language-service/compare/v0.0.7...v0.0.8
[0.0.7]: https://github.com/rcjsuen/dockerfile-language-service/compare/v0.0.6...v0.0.7
[0.0.6]: https://github.com/rcjsuen/dockerfile-language-service/compare/v0.0.5...v0.0.6
[0.0.5]: https://github.com/rcjsuen/dockerfile-language-service/compare/v0.0.4...v0.0.5
[0.0.4]: https://github.com/rcjsuen/dockerfile-language-service/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/rcjsuen/dockerfile-language-service/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/rcjsuen/dockerfile-language-service/compare/v0.0.1...v0.0.2

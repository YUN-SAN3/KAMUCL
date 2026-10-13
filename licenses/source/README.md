# Source for the portable wrapper's library payloads

These are complete, unchanged upstream archives supplied as source material.
Nothing here runs automatically during installation or game launch. The original
copyright, license, example and project files inside each archive remain intact.

| Component | Supplied file | Primary source |
| --- | --- | --- |
| StdUtils 1.14 | stdutils-1.14.tar.gz | https://codeload.github.com/lordmulder/stdutils/tar.gz/4e1117321001e54dcd2c52f72d3c359d5215e426 |
| Nsis7z 19.00 | Nsis7z_19.00.7z | https://nsis.sourceforge.io/mediawiki/images/6/69/Nsis7z_19.00.7z |
| 7-Zip 19.00 | 7zip-19.00-source.7z | https://www.7-zip.org/a/7z1900-src.7z |

Full archive SHA256 values and licenses are in
`docs/third-party-provenance.json` and `audit-reports/PRIMARY_LICENSE_VERIFICATION.json`
in the source distribution. The materials check also verifies these hashes.

For StdUtils, extract the 1.14 source and follow its `ReadMe.txt` and supplied
Visual Studio project under `Contrib/StdUtils`. Its original LGPL clarification
applies only to verbatim DLL payloads called through the NSIS plugin interface;
it does not waive the library's own license or authorize arbitrary modifications.

For Nsis7z, first extract the complete 7-Zip 19.00 source. Overlay the supplied
`Contrib/nsis7z/CPP` tree onto the 7-Zip source's `CPP` tree, preserving the NSIS
specific bundle and UI source. Open the included `CPP/7zip/Bundles/Nsis7z`
Visual Studio solution/project and select the matching architecture and Unicode
configuration. The supplied distribution retains examples and the original DLLs.
The source is not replaced with a later 7-Zip release.

The 1.1.21 portable EXE's x86-unicode Nsis7z plugin exactly matched the primary
19.00 binary. The StdUtils source tag matches the plugin's declared 1.14 version;
the audit did not rebuild it to establish byte-identical compiler output.
Modified plugins may be recombined by rebuilding the portable wrapper with the
documented project sources and builder; private launcher signing keys are not
required. These archives are not the source for the entire Electron/Chromium
runtime; its separately documented dependency graph must be considered separately.

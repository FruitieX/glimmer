{
  description = "Twinkly: live animations for Twinkly LED strings";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  outputs = {
    self,
    nixpkgs,
  }: let
    systems = ["x86_64-linux" "aarch64-linux"];
    each = nixpkgs.lib.genAttrs systems;
    build = system: let
      pkgs = import nixpkgs {inherit system;};
      frontend = pkgs.buildNpmPackage {
        pname = "twinkly-ui";
        version = "0.1.0";
        nodejs = pkgs.nodejs_26;
        src = pkgs.lib.cleanSourceWith {
          src = ./.;
          filter = path: type: !(builtins.elem (baseNameOf path) ["node_modules" "target" "dist" ".git" "data" "test-results" "result" "backend" "docs" "deploy" ".github"]);
        };
        npmDeps = pkgs.importNpmLock {npmRoot = ./.;};
        npmConfigHook = pkgs.importNpmLock.npmConfigHook;
        installPhase = ''mkdir -p $out/share/twinkly; cp -r dist/. $out/share/twinkly/'';
      };
      backend = pkgs.rustPlatform.buildRustPackage {
        pname = "twinkly";
        version = "0.1.0";
        # The backend embeds docs/effects.md (the scripting guide) as the AI's system prompt.
        src = pkgs.lib.fileset.toSource {
          root = ./.;
          fileset = pkgs.lib.fileset.unions [
            (pkgs.lib.fileset.difference ./backend (pkgs.lib.fileset.maybeMissing ./backend/target))
            ./docs/effects.md
          ];
        };
        cargoRoot = "backend";
        buildAndTestSubdir = "backend";
        cargoLock.lockFile = ./backend/Cargo.lock;
        # Tests talk to fake devices on localhost and are run separately in CI.
        doCheck = false;
      };
    in {inherit pkgs frontend backend;};
  in {
    packages = each (system: let
      inherit (build system) pkgs frontend backend;
    in {
      inherit frontend backend;
      default = backend;
      container = pkgs.dockerTools.buildLayeredImage {
        name = "ghcr.io/fruitiex/twinkly";
        tag = "main";
        contents = [backend frontend pkgs.cacert pkgs.tzdata pkgs.coreutils];
        extraCommands = ''mkdir -p data tmp; chmod 1777 tmp'';
        fakeRootCommands = ''chown 10001:10001 data'';
        config = {
          User = "10001:10001";
          Entrypoint = ["${backend}/bin/twinkly"];
          Env = [
            "TWINKLY_BIND=0.0.0.0:8080"
            "TWINKLY_DATA_DIR=/data"
            "TWINKLY_STATIC_DIR=${frontend}/share/twinkly"
            "SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
          ];
          ExposedPorts."8080/tcp" = {};
          Volumes."/data" = {};
        };
      };
    });
    devShells = each (system: let
      pkgs = (build system).pkgs;
    in {
      default = pkgs.mkShell {
        packages = with pkgs; [nodejs_26 cargo rustc rustfmt clippy gcc pkg-config chromium mosquitto];
        shellHook = ''export PLAYWRIGHT_CHROMIUM_EXECUTABLE=${pkgs.chromium}/bin/chromium'';
      };
    });
  };
}

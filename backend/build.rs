//! Embeds every built-in script in `js/effects` and `js/transitions`.

use std::{env, fs, path::Path};

fn main() {
    let mut out = String::new();
    for (dir, transition) in [("js/effects", false), ("js/transitions", true)] {
        println!("cargo:rerun-if-changed={dir}");
        let mut files: Vec<_> = fs::read_dir(dir)
            .unwrap()
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| p.extension().is_some_and(|x| x == "js"))
            .collect();
        files.sort();
        for path in files {
            let id = path.file_stem().unwrap().to_string_lossy().to_string();
            let abs = fs::canonicalize(&path).unwrap();
            println!("cargo:rerun-if-changed={}", path.display());
            out.push_str(&format!(
                "    ({id:?}, include_str!({:?}), {transition}),\n",
                abs.display().to_string()
            ));
        }
    }
    let dest = Path::new(&env::var("OUT_DIR").unwrap()).join("builtin.rs");
    fs::write(dest, format!("&[\n{out}]")).unwrap();
}

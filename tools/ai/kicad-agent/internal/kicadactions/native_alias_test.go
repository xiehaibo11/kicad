package kicadactions

import "testing"

func TestDocumentedEditorAliasesFindNativeTools(t *testing.T) {
	for _, group := range [][]string{
		{"3d-viewer", "3DViewer", "3d_viewer"},
		{"pagelayout_editor", "plEditor", "pl_editor"},
		{"pcbnew", "pcb"},
		{"eeschema", "schematic"},
	} {
		var names []string
		for _, alias := range group {
			matches := SearchNativeTools("", alias, "", false, 0)
			if len(matches) == 0 {
				t.Fatalf("documented/native alias %q returned no tools", alias)
			}
			if names == nil {
				for _, match := range matches {
					names = append(names, match.Name)
				}
			} else {
				if len(matches) != len(names) {
					t.Fatalf("alias %q returned %d tools, want %d", alias, len(matches), len(names))
				}
				for i, match := range matches {
					if match.Name != names[i] {
						t.Fatalf("alias %q changed action name: %s != %s", alias, match.Name, names[i])
					}
				}
			}
		}
	}
	front, ok := NativeToolByName("3DViewer.Control.viewFront")
	if !ok || front.Editor != "3d-viewer" || front.Name != "3DViewer.Control.viewFront" {
		t.Fatalf("native name must remain usable while editor is canonical: %+v", front)
	}
}

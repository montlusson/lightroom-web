// The decodable image the develop/export pipeline should work from:
// the AI-retouched version when it exists, otherwise the imported master.
export function masterOf(photo) {
  return photo.retouched || photo.master;
}

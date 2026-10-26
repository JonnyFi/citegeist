// Stand-in for the sharp image library (see package.json). Importing @huggingface/transformers
// needs a truthy "sharp" module; text embeddings and rerankers never call it. Using it for an
// image model fails with the message below instead of loading libvips (LGPL-3.0).
module.exports = function sharp() {
  throw new Error("Image processing is not available in citegeist: sharp is replaced by a stub.");
};

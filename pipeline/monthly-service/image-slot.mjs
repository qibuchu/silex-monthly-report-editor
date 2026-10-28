export function isImageSlot(object) {
  const attributes = object.attributes || {};
  return attributes['data-kind'] === 'image' ||
    attributes['data-pptx-kind'] === 'image' ||
    /-image-\d+$/.test(attributes['data-object-id'] || '') ||
    /<img\b/i.test(object.content || '');
}

export function blankContent(object) {
  if (object.tagName === 'table' || object.attributes?.['data-kind'] === 'table') {
    return object.content.replace(/(<t[dh]\b[^>]*>)[\s\S]*?(<\/t[dh]>)/gi, '$1<p></p>$2');
  }
  return isImageSlot(object)
    ? '<div class="imagebox" data-image-slot="true" aria-label="待上传图片"></div>'
    : '<p></p>';
}

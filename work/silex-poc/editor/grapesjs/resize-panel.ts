export default function(editor) {
  editor.Panels.addPanel({
    id: 'viewsOptions',
    buttons: [{
      id: 'resize',
      // icon for arrow left
      className: 'viewsOptions__size-btn',
      command: 'resize-panel',
      attributes: { title: '调整面板宽度' },
    }],
  })
  editor.Commands.add('resize-panel', {
    run: (editor, sender) => {
      document.documentElement.style.setProperty('--viewsPanelWidth', '40%')
    },
    stop: (editor, sender) => {
      // restore the default width (from CSS) instead of forcing a smaller one
      document.documentElement.style.removeProperty('--viewsPanelWidth')
    },
  })
}

(function () {
  var SUPABASE_URL = 'https://phxummlwlnhprchuzcyu.supabase.co';
  var SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBoeHVtbWx3bG5ocHJjaHV6Y3l1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3NzgyMzQsImV4cCI6MjA5NTM1NDIzNH0.HsJ9apcWseGugkfdUw24anRYoMJ0ZLjbshWX6MYAvNc';
  var FUNCTION_URL = SUPABASE_URL + '/functions/v1/send-comment';

  var slug = new URLSearchParams(location.search).get('slug');
  if (!slug) return;

  var ls = window.SiteCommon && window.SiteCommon.loadSiteConfig;
  if (ls) {
    ls().then(function (config) {
      if (config && config.commentEnabled === false) return;
      boot();
    });
  } else {
    boot();
  }

  function boot() {
    var pendingComments = [];

    var AVATAR_ICONS = [
      { cls: 'fa-solid fa-user' },
      { cls: 'fa-solid fa-ghost' },
      { cls: 'fa-solid fa-mug-hot' },
      { cls: 'fa-solid fa-meteor' },
      { cls: 'fa-solid fa-star' },
      { cls: 'fa-solid fa-moon' },
    ];

    function avatarPickerHtml() {
      var html = '<div class="avatar-picker">';
      for (var i = 0; i < AVATAR_ICONS.length; i++) {
        html += '<span class="avatar-option" data-emoji="' + AVATAR_ICONS[i].cls + '"><i class="' + AVATAR_ICONS[i].cls + '"></i></span>';
      }
      html += '<input type="hidden" class="comment-avatar" value="fa-solid fa-comment" /></div>';
      return html;
    }

    function setupAvatarPicker(container) {
      var opts = container.querySelectorAll('.avatar-option');
      var hidden = container.querySelector('.comment-avatar');
      for (var i = 0; i < opts.length; i++) {
        (function (opt) {
          opt.addEventListener('click', function () {
            var emoji = opt.getAttribute('data-emoji');
            for (var j = 0; j < opts.length; j++) opts[j].classList.remove('selected');
            if (emoji) {
              opt.classList.add('selected');
              hidden.value = emoji;
            } else {
              hidden.value = '';
            }
          });
        })(opts[i]);
      }
    }

    function avatarDisplay(avatar) {
      var icon = avatar || 'fa-solid fa-comment';
      if (icon.indexOf('fa-') === 0) {
        return '<span class="comment-avatar"><i class="' + escapeHtml(icon) + '"></i></span>';
      }
      return '<span class="comment-avatar">' + escapeHtml(icon) + '</span>';
    }

    var headers = {
      apikey: SUPABASE_KEY,
      Authorization: 'Bearer ' + SUPABASE_KEY,
    };

    function escapeHtml(str) {
      var d = document.createElement('div');
      d.textContent = str;
      return d.innerHTML;
    }

    function formatTime(dateStr) {
      return new Date(dateStr).toLocaleString('zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
      });
    }

    function buildCommentTree(comments) {
      var topLevel = [];
      var byParent = {};
      for (var i = 0; i < comments.length; i++) {
        var c = comments[i];
        if (c.parent_id) {
          if (!byParent[c.parent_id]) byParent[c.parent_id] = [];
          byParent[c.parent_id].push(c);
        } else {
          topLevel.push(c);
        }
      }
      return { topLevel: topLevel, byParent: byParent };
    }

    function renderComments(list, comments) {
      list.innerHTML = '';
      var tree = buildCommentTree(comments);

      for (var i = 0; i < tree.topLevel.length; i++) {
        var c = tree.topLevel[i];
        var group = document.createElement('div');
        group.className = 'comment-group';

        var mainEl = buildCommentItem(c, null, tree.byParent, comments);
        group.appendChild(mainEl);

        // Flatten all descendant replies at one indentation level
        var flatReplies = [];
        flattenReplies(c.id, tree.byParent, comments, flatReplies);
        var repliesContainer = mainEl.querySelector('.comment-replies');
        for (var j = 0; j < flatReplies.length; j++) {
          var r = flatReplies[j];
          var replyEl = buildCommentItem(r, r._replyTo, tree.byParent, comments);
          replyEl.className = 'comment-item comment-reply-item';
          repliesContainer.appendChild(replyEl);
        }

        if (flatReplies.length > 0) {
          (function (container, cnt) {
            var toggleBtn = document.createElement('button');
            toggleBtn.className = 'comment-toggle-btn';
            toggleBtn.type = 'button';
            var collapsed = false;
            toggleBtn.textContent = '收起回复 (' + cnt + ')';
            toggleBtn.addEventListener('click', function () {
              collapsed = !collapsed;
              container.style.display = collapsed ? 'none' : '';
              toggleBtn.textContent = collapsed
                ? '展开回复 (' + cnt + ')'
                : '收起回复 (' + cnt + ')';
            });
            container.parentNode.insertBefore(toggleBtn, container);
          })(repliesContainer, flatReplies.length);
        }

        list.appendChild(group);
      }
    }

    function flattenReplies(parentId, byParent, allComments, result) {
      var kids = byParent[parentId];
      if (!kids) return;
      for (var i = 0; i < kids.length; i++) {
        var kid = kids[i];
        // Find direct parent's name
        for (var j = 0; j < allComments.length; j++) {
          if (allComments[j].id === kid.parent_id) {
            kid._replyTo = allComments[j].name || '匿名';
            break;
          }
        }
        result.push(kid);
        flattenReplies(kid.id, byParent, allComments, result);
      }
    }

    function buildCommentItem(c, parentName, byParent, allComments) {
      var el = document.createElement('div');
      el.className = 'comment-item';
      if (c.approved === false) el.className += ' comment-pending';

      var replyToHtml = parentName
        ? '<div class="reply-to-label">回复 @' + escapeHtml(parentName) + '</div>'
        : '';

      el.innerHTML =
        '<div class="comment-meta">' +
          avatarDisplay(c.avatar) +
          '<strong>' + escapeHtml(c.name || '匿名') + '</strong>' +
          replyToHtml +
          '<span class="comment-date">' + formatTime(c.created_at) + '</span>' +
      (c.approved === false ? '<span class="comment-pending-badge">待审核</span>' : '') +
        '</div>' +
        '<div class="comment-body">' + escapeHtml(c.content) + '</div>' +
        '<button class="comment-reply-btn">回复</button>' +
        '<div class="comment-reply-form" style="display:none">' +
          '<div class="avatar-picker-wrap"><span class="avatar-label">头像：</span>' + avatarPickerHtml() + '</div>' +
          '<input type="text" class="reply-name" placeholder="你的名字" maxlength="20" />' +
          '<input type="email" class="reply-email" placeholder="邮箱（回复通知，选填）" maxlength="100" />' +
          '<textarea class="reply-content" rows="2" placeholder="写下你的回复..." required></textarea>' +
          '<div class="reply-actions">' +
            '<button type="button" class="reply-submit btn">提交</button>' +
            '<button type="button" class="reply-cancel btn">取消</button>' +
          '</div>' +
        '</div>' +
        '<div class="comment-replies"></div>';

      setupAvatarPicker(el.querySelector('.avatar-picker'));

      var replyBtn = el.querySelector('.comment-reply-btn');
      var replyForm = el.querySelector('.comment-reply-form');
      var replyName = el.querySelector('.reply-name');
      var replyEmail = el.querySelector('.reply-email');
      var replyContent = el.querySelector('.reply-content');
      var replyAvatar = el.querySelector('.avatar-picker .comment-avatar');

      replyBtn.addEventListener('click', function () {
        var hidden = replyForm.style.display === 'none';
        replyForm.style.display = hidden ? 'block' : 'none';
        if (hidden) replyContent.focus();
      });

      el.querySelector('.reply-cancel').addEventListener('click', function () {
        replyForm.style.display = 'none';
      });

      el.querySelector('.reply-submit').addEventListener('click', function () {
        var name = replyName.value.trim() || '';
        var email = replyEmail.value.trim() || '';
        var avatar = replyAvatar ? replyAvatar.value : '';
        var content = replyContent.value.trim();
        if (!content) return;
        var btn = this;
        btn.disabled = true;
        postComment(slug, name, email, avatar, content, c.id, function (ok, commentData) {
          btn.disabled = false;
          if (ok) {
            replyForm.style.display = 'none';
            replyName.value = '';
            replyEmail.value = '';
            replyAvatar.value = '';
            replyContent.value = '';
            if (commentData) pendingComments.push(commentData);
            loadAndRender();
          }
        });
      });

      return el;
    }

    function loadAndRender() {
      loadComments(slug, function (comments) {
        for (var i = 0; i < pendingComments.length; i++) {
          comments.push(pendingComments[i]);
        }
        pendingComments = [];
        renderComments(list, comments);
      });
    }

    function loadComments(slug, callback) {
      fetch(SUPABASE_URL + '/rest/v1/comments?slug=eq.' + encodeURIComponent(slug) + '&approved=eq.true&order=created_at.asc', {
        headers: headers,
      })
        .then(function (r) { return r.json(); })
        .then(function (data) { callback(data || []); })
        .catch(function () { callback([]); });
    }

    function getPageTitle() {
      var el = document.getElementById('post-title');
      return el ? el.textContent : '';
    }

    function postComment(slug, name, email, avatar, content, parentId, callback) {
      var body = { slug: slug, name: name, content: content, page_url: location.href, post_title: getPageTitle() };
      if (email) body.email = email;
      if (avatar) body.avatar = avatar;
      if (parentId) body.parent_id = parentId;
      fetch(FUNCTION_URL, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: 'Bearer ' + SUPABASE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
        .then(function (r) {
          if (!r.ok) { callback(false); return; }
          r.json().then(function (data) {
            callback(true, data && data.comment ? data.comment : null);
          });
        })
        .catch(function () { callback(false); });
    }

    var section = document.createElement('section');
    section.className = 'comment-section block';
    var mainAvatarHtml = avatarPickerHtml();
    section.innerHTML =
      '<h2>评论</h2>' +
      '<div id="comment-list" class="comment-list"></div>' +
      '<form id="comment-form" class="comment-form">' +
        '<div class="avatar-picker-wrap"><span class="avatar-label">头像：</span>' + mainAvatarHtml + '</div>' +
        '<input id="comment-name" type="text" placeholder="你的名字（留空显示为匿名）" maxlength="20" />' +
        '<input id="comment-email" type="email" placeholder="邮箱（收到回复时通知你，选填）" maxlength="100" />' +
        '<textarea id="comment-content" rows="3" placeholder="写下你的评论..." required></textarea>' +
        '<button type="submit" class="btn">发表评论</button>' +
      '</form>';

    var contentNode = document.getElementById('post-content');
    if (!contentNode) return;
    contentNode.parentNode.insertBefore(section, contentNode.nextSibling);

    setupAvatarPicker(section.querySelector('.avatar-picker'));

    var list = section.querySelector('#comment-list');
    var form = section.querySelector('#comment-form');
    var nameInput = section.querySelector('#comment-name');
    var emailInput = section.querySelector('#comment-email');
    var contentInput = section.querySelector('#comment-content');
    var avatarInput = section.querySelector('.comment-avatar');

    loadAndRender();

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = nameInput.value.trim() || '';
      var email = emailInput.value.trim() || '';
      var avatar = avatarInput ? avatarInput.value : '';
      var content = contentInput.value.trim();
      if (!content) return;
      var btn = form.querySelector('button');
      btn.disabled = true;
      postComment(slug, name, email, avatar, content, null, function (ok, commentData) {
        btn.disabled = false;
        if (ok) {
          contentInput.value = '';
          if (avatarInput) avatarInput.value = '';
          if (commentData) pendingComments.push(commentData);
          loadAndRender();
        }
      });
    });
  }
})();

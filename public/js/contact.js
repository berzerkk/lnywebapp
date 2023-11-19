$(document).ready(function () {
  $('.contact-submit').click(function() {
    let data = {
      'firstname': $('#firstname').val(),
      'lastname': $('#lastname').val(),
      'mail': $('#mail').val(),
      'phone': $('#phone').val(),
      'role': $('#role').val()
    }
    if ($('#confidentialite:checked').val() !== 'on') return
    $.post("mail", data, (result) => {
      $('.contact-submit').hide()
      $('.contact-submit').unbind('click');
    });
  });

});

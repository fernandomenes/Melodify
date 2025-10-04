function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const content = document.getElementById('content');
    sidebar.classList.toggle('active');
    content.classList.toggle('shifted');
}

function hideSidebar(event) {
    const sidebar = document.getElementById('sidebar');
    const content = document.getElementById('content');
    if (!sidebar.contains(event.target) && sidebar.classList.contains('active')) {
        sidebar.classList.remove('active');
        content.classList.remove('shifted');
    }
}
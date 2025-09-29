function sumar() {
       const num1 = parseFloat(document.getElementById('numero1').value);
       const num2 = parseFloat(document.getElementById('numero2').value);
       if (!isNaN(num1) && !isNaN(num2)) {
           const suma = num1 + num2;
           document.getElementById('resultado').innerText = `Resultado: ${suma}`;
       } else {
           document.getElementById('resultado').innerText = 'Por favor, ingrese números válidos';
       }
   }
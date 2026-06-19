import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PhoneInput } from './PhoneInput';

/**
 * PhoneInput — seletor de país (DDI) + número nacional → emite E.164.
 * Estado local autoritativo; seeda do `value` externo (E.164) ao carregar.
 */
describe('PhoneInput', () => {
  beforeEach(() => cleanup());

  it('digitar número nacional emite E.164 com +55 (default BR)', () => {
    const onChange = vi.fn();
    render(<PhoneInput testId="tel" value="" onChange={onChange} />);
    fireEvent.change(screen.getByTestId('tel'), { target: { value: '11970535832' } });
    expect(onChange).toHaveBeenLastCalledWith('+5511970535832');
  });

  it('trocar país muda o DDI do E.164', () => {
    const onChange = vi.fn();
    render(<PhoneInput testId="tel" value="" onChange={onChange} />);
    fireEvent.change(screen.getByTestId('tel'), { target: { value: '4155552671' } });
    fireEvent.change(screen.getByTestId('tel-pais'), { target: { value: 'US' } });
    expect(onChange).toHaveBeenLastCalledWith('+14155552671');
  });

  it('seeda país + número a partir de um E.164 existente', () => {
    const { rerender } = render(<PhoneInput testId="tel" value="+14155552671" onChange={() => {}} />);
    expect((screen.getByTestId('tel-pais') as HTMLSelectElement).value).toBe('US');
    rerender(<PhoneInput testId="tel" value="+5511970535832" onChange={() => {}} />);
    expect((screen.getByTestId('tel-pais') as HTMLSelectElement).value).toBe('BR');
  });

  it('número vazio emite string vazia', () => {
    const onChange = vi.fn();
    render(<PhoneInput testId="tel" value="+5511970535832" onChange={onChange} />);
    fireEvent.change(screen.getByTestId('tel'), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith('');
  });
});
